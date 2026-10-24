package cn.xuye.study;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceResponse;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.webkit.PermissionRequest;
import android.Manifest;
import android.content.pm.PackageManager;
import android.util.Base64;
import java.io.OutputStream;
import java.util.ArrayDeque;
import android.content.Intent;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.content.Context;
import org.json.JSONObject;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.Wearable;
import androidx.webkit.WebViewAssetLoader;

/** 手机与平板共用网页版；WebView 的 IndexedDB 仍保存在这台 Android 设备内。 */
public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<android.net.Uri[]> fileCallback;
    private String allowedOrigin;
    private volatile boolean localMode = true;
    private volatile WebViewAssetLoader assetLoader;
    private PermissionRequest audioRequest;
    private final ArrayDeque<ExportFile> exports = new ArrayDeque<>();
    private ExportFile pendingExport;
    private static class ExportFile {
        final String name, mime;
        final byte[] bytes;
        ExportFile(String name, String mime, byte[] bytes) { this.name = name; this.mime = mime; this.bytes = bytes; }
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        // 仅测试签名 APK 可用 ADB 检查页面；发布版不会打开调试接口。
        WebView.setWebContentsDebuggingEnabled(
            (getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        openBundled();
    }
    private void showSetup() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 48, 32, 24);
        TextView hint = new TextView(this);
        hint.setText("连接你自行部署的续页服务器，使用服务器账号手动发送和接收任务。跨公网请使用 HTTPS；当前本机任务不会自动搬迁，可先导出完整 ZIP 再在服务器空间导入。");
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("https://你的续页服务器地址");
        input.setText(getPreferences(MODE_PRIVATE).getString("gateway", ""));
        Button button = new Button(this);
        button.setText("连接服务器");
        button.setOnClickListener(v -> {
            String address = input.getText().toString().trim();
            try {
                android.net.Uri uri = android.net.Uri.parse(address);
                if ((!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) || uri.getHost() == null) throw new IllegalArgumentException();
                getPreferences(MODE_PRIVATE).edit().putString("gateway", address).apply();
                openRemote(address);
            } catch (Exception e) { input.setError("请输入完整的 http:// 或 https:// 地址"); }
        });
        Button local = new Button(this);
        local.setText("返回本机空间");
        local.setOnClickListener(v -> openBundled());
        root.addView(hint); root.addView(input); root.addView(button); root.addView(local);
        setContentView(root);
    }
    private void openBundled() {
        localMode = true;
        assetLoader = new WebViewAssetLoader.Builder()
            .addPathHandler("/", new WebViewAssetLoader.AssetsPathHandler(this))
            .build();
        open("https://appassets.androidplatform.net/index.html");
    }
    private void openRemote(String address) {
        localMode = false;
        assetLoader = null;
        open(address);
    }
    private void open(String address) {
        android.net.Uri base = android.net.Uri.parse(address);
        allowedOrigin = base.getScheme() + "://" + base.getAuthority();
        if (web != null) {
            android.view.ViewGroup parent = (android.view.ViewGroup) web.getParent();
            if (parent != null) parent.removeView(web);
            web.destroy();
        }
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                return assetLoader == null ? null : assetLoader.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                return !sameOrigin(request.getUrl());
            }
        });
        // 支持任务材料与语音文件上传；结果仍进入 WebView 本机存储。
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<android.net.Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { startActivityForResult(params.createIntent(), 1001); return true; }
                catch (Exception error) { fileCallback = null; callback.onReceiveValue(null); return false; }
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                // 只给正在显示的页面开放录音权限，并让 Android 系统弹出授权框。
                if (!sameOrigin(request.getOrigin()) || !java.util.Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                    request.deny();
                    return;
                }
                if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                    request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                } else {
                    audioRequest = request;
                    requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 1002);
                }
            }
        });
        web.addJavascriptInterface(new OverviewBridge(this), "XuYeAndroid");
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        LinearLayout toolbar = new LinearLayout(this);
        Button local = new Button(this); local.setText("本机"); local.setOnClickListener(v -> openBundled());
        Button remote = new Button(this); remote.setText("连接服务器"); remote.setOnClickListener(v -> showSetup());
        toolbar.addView(local, new LinearLayout.LayoutParams(0, 48, 1));
        toolbar.addView(remote, new LinearLayout.LayoutParams(0, 48, 1));
        root.addView(toolbar);
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        web.loadUrl(address);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1001 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
        if (request == 1003 && pendingExport != null) {
            if (result == RESULT_OK && data != null && data.getData() != null) {
                try (OutputStream output = getContentResolver().openOutputStream(data.getData())) {
                    if (output != null) output.write(pendingExport.bytes);
                } catch (Exception error) {
                    android.widget.Toast.makeText(this, "保存失败：" + error.getMessage(), android.widget.Toast.LENGTH_LONG).show();
                }
            }
            pendingExport = null;
            startNextExport();
        }
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == 1002 && audioRequest != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED)
                audioRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else audioRequest.deny();
            audioRequest = null;
        }
    }
    private void startNextExport() {
        if (pendingExport != null || exports.isEmpty()) return;
        pendingExport = exports.remove();
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(pendingExport.mime);
        intent.putExtra(Intent.EXTRA_TITLE, pendingExport.name);
        try { startActivityForResult(intent, 1003); }
        catch (Exception error) { pendingExport = null; startNextExport(); }
    }
    private boolean sameOrigin(android.net.Uri uri) {
        return (uri.getScheme() + "://" + uri.getAuthority()).equalsIgnoreCase(allowedOrigin);
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    private static class OverviewBridge {
        private final MainActivity activity;
        private final Context context;
        OverviewBridge(MainActivity activity) { this.activity = activity; this.context = activity.getApplicationContext(); }
        @JavascriptInterface public boolean isEmbedded() { return activity.localMode; }
        @JavascriptInterface public void openServerSetup() {
            // 仅本机内置页面能打开切换入口；实际连接仍需用户填写完整地址。
            if (activity.localMode) activity.runOnUiThread(activity::showSetup);
        }
        @JavascriptInterface public void requestAi(String id, String path, String body) {
            if (!activity.localMode || id.length() > 100 || body.length() > 30 * 1024 * 1024) return;
            new Thread(() -> {
                boolean success = true;
                String payload;
                try { payload = NativeAi.perform(path, new JSONObject(body)).toString(); }
                catch (Exception error) {
                    success = false;
                    payload = error.getMessage() == null ? "模型调用失败" : error.getMessage();
                }
                final boolean okay = success;
                final String value = payload;
                activity.runOnUiThread(() -> {
                    if (activity.web != null && activity.localMode)
                        activity.web.evaluateJavascript("window.__xuYeNativeResolve(" +
                            JSONObject.quote(id) + "," + okay + "," + JSONObject.quote(value) + ")", null);
                });
            }, "xuYe-ai").start();
        }
        @JavascriptInterface public void saveFile(String name, String mime, String base64) {
            // 系统文件选择器负责决定保存位置；应用不申请广泛存储权限。
            if (base64.length() > 72 * 1024 * 1024) return;
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                if (bytes.length > 50 * 1024 * 1024) return;
                String safeName = name.replaceAll("[\\\\/:*?\"<>|]", "_");
                if (safeName.length() > 120) safeName = safeName.substring(0, 120);
                ExportFile file = new ExportFile(safeName, mime.isEmpty() ? "application/octet-stream" : mime, bytes);
                activity.runOnUiThread(() -> {
                    activity.exports.add(file);
                    activity.startNextExport();
                });
            } catch (Exception ignored) { /* 无效的下载内容不会写入设备。 */ }
        }
        @JavascriptInterface public void updateOverview(String payload) {
            try {
                JSONObject json = new JSONObject(payload);
                int count = Math.max(0, Math.min(999, json.optInt("waiting", 0)));
                String title = json.optString("title", "暂无待续接任务");
                if (title.length() > 80) title = title.substring(0, 80);
                context.getSharedPreferences("overview", Context.MODE_PRIVATE).edit().putInt("waiting", count).putString("title", title).apply();
                OverviewWidget.refresh(context);
                // Data Layer 把简短总览主动发往已配对 Wear OS 手表，不传笔记与账号密钥。
                PutDataMapRequest item = PutDataMapRequest.create("/overview");
                item.getDataMap().putInt("waiting", count);
                item.getDataMap().putString("title", title);
                item.getDataMap().putLong("updated", System.currentTimeMillis());
                Wearable.getDataClient(context).putDataItem(item.asPutDataRequest().setUrgent());
            } catch (Exception ignored) { /* 错误数据不会覆盖小组件。 */ }
        }
    }
}
