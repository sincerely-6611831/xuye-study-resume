package cn.xuye.study;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.content.Intent;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.content.Context;
import org.json.JSONObject;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.Wearable;

/** 手机与平板共用网页版；WebView 的 IndexedDB 仍保存在这台 Android 设备内。 */
public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<android.net.Uri[]> fileCallback;
    private String allowedOrigin;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        String saved = getPreferences(MODE_PRIVATE).getString("gateway", "");
        if (saved.isEmpty()) showSetup(); else open(saved);
    }
    private void showSetup() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(32, 48, 32, 24);
        TextView hint = new TextView(this);
        hint.setText("输入运行续页服务的电脑地址，例如 http://192.168.1.10:8000 。两台设备需要能互相访问。首次登录需要连接服务。");
        EditText input = new EditText(this);
        input.setSingleLine(true);
        input.setHint("http://电脑IP:8000");
        input.setText(getPreferences(MODE_PRIVATE).getString("gateway", ""));
        Button button = new Button(this);
        button.setText("连接续页");
        button.setOnClickListener(v -> {
            String address = input.getText().toString().trim();
            try {
                android.net.Uri uri = android.net.Uri.parse(address);
                if ((!"http".equals(uri.getScheme()) && !"https".equals(uri.getScheme())) || uri.getHost() == null) throw new IllegalArgumentException();
                getPreferences(MODE_PRIVATE).edit().putString("gateway", address).apply();
                open(address);
            } catch (Exception e) { input.setError("请输入完整的 http:// 或 https:// 地址"); }
        });
        root.addView(hint); root.addView(input); root.addView(button);
        setContentView(root);
    }
    private void open(String address) {
        android.net.Uri base = android.net.Uri.parse(address);
        allowedOrigin = base.getScheme() + "://" + base.getAuthority();
        web = new WebView(this);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.setWebViewClient(new WebViewClient() {
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
        });
        web.addJavascriptInterface(new OverviewBridge(this), "XuYeAndroid");
        setContentView(web);
        web.loadUrl(address);
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1001 && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            fileCallback = null;
        }
    }
    private boolean sameOrigin(android.net.Uri uri) {
        return (uri.getScheme() + "://" + uri.getAuthority()).equalsIgnoreCase(allowedOrigin);
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
    private static class OverviewBridge {
        private final Context context;
        OverviewBridge(Context context) { this.context = context.getApplicationContext(); }
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
