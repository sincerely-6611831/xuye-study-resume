package cn.xuye.study.wear;

import android.app.Activity;
import android.os.Bundle;
import android.graphics.Color;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import com.google.android.gms.wearable.DataEvent;
import com.google.android.gms.wearable.DataEventBuffer;
import com.google.android.gms.wearable.DataMapItem;
import com.google.android.gms.wearable.Wearable;

/** 手表只显示配对手机主动传来的简短总览；圆屏使用居中安全区和可滚动内容。 */
public class WatchActivity extends Activity {
    private TextView count, title;
    private final com.google.android.gms.wearable.DataClient.OnDataChangedListener listener = events -> {
        for (DataEvent event : events) if (event.getType() == DataEvent.TYPE_CHANGED && "/overview".equals(event.getDataItem().getUri().getPath())) {
            com.google.android.gms.wearable.DataMap data = DataMapItem.fromDataItem(event.getDataItem()).getDataMap();
            int waiting = data.getInt("waiting");
            String name = data.getString("title");
            getPreferences(MODE_PRIVATE).edit().putInt("waiting", waiting).putString("title", name).apply();
            runOnUiThread(this::render);
        }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setGravity(Gravity.CENTER);
        int width = getResources().getDisplayMetrics().widthPixels;
        // 圆屏边缘不可读：两侧留出约 17% 的宽度。
        int inset = Math.round(width * 0.17f);
        body.setPadding(inset, 24, inset, 24);
        TextView brand = new TextView(this);
        brand.setText("续页"); brand.setTextSize(17); brand.setTextColor(Color.WHITE); brand.setGravity(Gravity.CENTER);
        count = new TextView(this); count.setTextSize(30); count.setTextColor(Color.WHITE); count.setGravity(Gravity.CENTER);
        title = new TextView(this); title.setTextSize(13); title.setTextColor(Color.LTGRAY); title.setGravity(Gravity.CENTER); title.setMaxLines(3);
        body.addView(brand); body.addView(count); body.addView(title);
        scroll.addView(body); scroll.setBackgroundColor(Color.rgb(25, 49, 36)); setContentView(scroll); render();
        Wearable.getDataClient(this).getDataItems().addOnSuccessListener(items -> {
            for (com.google.android.gms.wearable.DataItem item : items) if ("/overview".equals(item.getUri().getPath())) {
                com.google.android.gms.wearable.DataMap data = DataMapItem.fromDataItem(item).getDataMap();
                getPreferences(MODE_PRIVATE).edit().putInt("waiting", data.getInt("waiting")).putString("title", data.getString("title")).apply();
            }
            items.release(); render();
        });
    }
    private void render() {
        count.setText(getPreferences(MODE_PRIVATE).getInt("waiting", 0) + " 项待续接");
        title.setText(getPreferences(MODE_PRIVATE).getString("title", "配对手机打开续页后显示总览"));
    }
    @Override protected void onResume() { super.onResume(); Wearable.getDataClient(this).addListener(listener); }
    @Override protected void onPause() { Wearable.getDataClient(this).removeListener(listener); super.onPause(); }
}
