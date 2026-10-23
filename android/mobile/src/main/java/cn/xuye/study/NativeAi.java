package cn.xuye.study;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** APK 自带的模型协议适配器。只在用户主动测试、转写或生成时连接其配置的地址。 */
final class NativeAi {
    private static final String KEY_ALIAS = "XuYeApiKey";
    private static final int MAX_REPLY = 1024 * 1024;

    private static SecretKey deviceKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }
    private static String seal(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, deviceKey());
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] packed = new byte[iv.length + encrypted.length];
        System.arraycopy(iv, 0, packed, 0, iv.length);
        System.arraycopy(encrypted, 0, packed, iv.length, encrypted.length);
        return Base64.encodeToString(packed, Base64.NO_WRAP);
    }
    private static String unseal(String packed) throws Exception {
        if (packed.isEmpty()) return "";
        byte[] bytes = Base64.decode(packed, Base64.DEFAULT);
        if (bytes.length < 29) throw new IllegalArgumentException("模型密钥已失效，请重新填写");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, deviceKey(), new GCMParameterSpec(128, bytes, 0, 12));
        return new String(cipher.doFinal(bytes, 12, bytes.length - 12), StandardCharsets.UTF_8);
    }
    private static URL endpoint(String value) throws Exception {
        URL url = new URL(value);
        if ((!url.getProtocol().equals("http") && !url.getProtocol().equals("https")) ||
            url.getHost().isEmpty() || url.getUserInfo() != null)
            throw new IllegalArgumentException("请填写完整的 HTTP 或 HTTPS 模型地址");
        return url;
    }
    private static HttpURLConnection connection(URL url, JSONObject config, String method) throws Exception {
        HttpURLConnection client = (HttpURLConnection) url.openConnection();
        client.setInstanceFollowRedirects(false);
        int seconds = Math.max(5, Math.min(120, config.optInt("timeout", 30)));
        client.setConnectTimeout(seconds * 1000);
        client.setReadTimeout(seconds * 1000);
        client.setRequestMethod(method);
        String key = unseal(config.optString("encrypted_key", ""));
        if (!key.isEmpty()) client.setRequestProperty("Authorization", "Bearer " + key);
        return client;
    }
    private static JSONObject response(HttpURLConnection client) throws Exception {
        try {
            int code = client.getResponseCode();
            InputStream input = code >= 400 ? client.getErrorStream() : client.getInputStream();
            if (code < 200 || code >= 300) throw new IllegalStateException("模型服务返回 HTTP " + code);
            if (input == null) throw new IllegalStateException("模型服务没有返回内容");
            try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = stream.read(buffer)) != -1) {
                    if (output.size() + count > MAX_REPLY) throw new IllegalStateException("模型回复过大");
                    output.write(buffer, 0, count);
                }
                return new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
            }
        } finally { client.disconnect(); }
    }
    private static JSONObject postJson(JSONObject config, JSONObject payload) throws Exception {
        HttpURLConnection client = connection(endpoint(config.getString("api_url")), config, "POST");
        client.setDoOutput(true);
        client.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        try (OutputStream output = client.getOutputStream()) {
            output.write(payload.toString().getBytes(StandardCharsets.UTF_8));
        }
        return response(client);
    }
    private static String chat(JSONObject config, String prompt) throws Exception {
        JSONObject payload = new JSONObject()
            .put("model", config.getString("model"))
            .put("messages", new JSONArray().put(new JSONObject().put("role", "user").put("content", prompt)));
        String raw = postJson(config, payload).getJSONArray("choices")
            .getJSONObject(0).getJSONObject("message").getString("content");
        if (raw.isEmpty() || raw.length() > 60000) throw new IllegalStateException("模型回复为空或过长");
        return raw;
    }
    private static JSONObject models(JSONObject config) throws Exception {
        String address = config.getString("api_url");
        if (!address.endsWith("/chat/completions")) throw new IllegalArgumentException("读取模型列表需要 Chat Completions 地址");
        HttpURLConnection client = connection(endpoint(address.substring(0, address.length() - 17) + "/models"), config, "GET");
        JSONArray source = response(client).getJSONArray("data");
        if (source.length() > 1000) throw new IllegalStateException("模型列表过长");
        JSONArray names = new JSONArray();
        for (int i = 0; i < source.length(); i++) {
            String name = source.getJSONObject(i).getString("id");
            if (name.length() > 0 && name.length() <= 150) names.put(name);
        }
        return new JSONObject().put("models", names);
    }
    private static void field(OutputStream output, String boundary, String key, String value) throws Exception {
        String part = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + key + "\"\r\n\r\n" + value + "\r\n";
        output.write(part.getBytes(StandardCharsets.UTF_8));
    }
    private static JSONObject transcribe(JSONObject body) throws Exception {
        JSONObject config = body.getJSONObject("config");
        byte[] audio = Base64.decode(body.getString("audio"), Base64.DEFAULT);
        if (audio.length == 0 || audio.length > 20 * 1024 * 1024) throw new IllegalArgumentException("音频应为 1 字节至 20MB");
        String boundary = "XuYe" + System.currentTimeMillis();
        HttpURLConnection client = connection(endpoint(config.getString("api_url")), config, "POST");
        client.setDoOutput(true);
        client.setChunkedStreamingMode(8192);
        client.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        try (OutputStream output = client.getOutputStream()) {
            field(output, boundary, "model", config.getString("model"));
            field(output, boundary, "response_format", "json");
            String language = config.optString("language", "");
            if (!language.isEmpty()) field(output, boundary, "language", language);
            String mime = body.optString("mime", "audio/webm").replaceAll("[\r\n]", "");
            String filename = body.optString("name", "recording.webm").replaceAll("[\\\"\r\n]", "_");
            output.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"" +
                filename + "\"\r\nContent-Type: " + mime + "\r\n\r\n").getBytes(StandardCharsets.UTF_8));
            output.write(audio);
            output.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
        }
        String transcript = response(client).getString("text").trim();
        if (transcript.isEmpty() || transcript.length() > 30000) throw new IllegalStateException("转写结果为空或过长");
        return new JSONObject().put("transcript", transcript).put("model", config.getString("model"));
    }
    static JSONObject perform(String path, JSONObject body) throws Exception {
        if (path.equals("/local-ai/seal")) {
            String key = body.optString("api_key", "");
            if (key.length() > 4000) throw new IllegalArgumentException("密钥过长");
            return new JSONObject().put("encrypted_key", key.isEmpty() ? "" : seal(key));
        }
        if (path.equals("/local-ai/chat"))
            return new JSONObject().put("raw", chat(body.getJSONObject("config"), body.getString("prompt")));
        if (path.equals("/local-ai/models")) return models(body.getJSONObject("config"));
        if (path.equals("/local-ai/transcribe")) return transcribe(body);
        throw new IllegalArgumentException("APK 不支持此模型操作");
    }
}
