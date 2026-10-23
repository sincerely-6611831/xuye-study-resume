package cn.xuye.study;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/** Android 官方 AppWidgetProvider：展示手机本机最近一次打开应用时的总览。 */
public class OverviewWidget extends AppWidgetProvider {
    public static void refresh(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        android.content.ComponentName component = new android.content.ComponentName(context, OverviewWidget.class);
        int[] ids = manager.getAppWidgetIds(component);
        for (int id : ids) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_overview);
            android.content.SharedPreferences data = context.getSharedPreferences("overview", Context.MODE_PRIVATE);
            views.setTextViewText(R.id.count, data.getInt("waiting", 0) + " 项");
            views.setTextViewText(R.id.title, data.getString("title", "打开应用查看"));
            Intent open = new Intent(context, MainActivity.class);
            PendingIntent click = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            views.setOnClickPendingIntent(R.id.title, click);
            manager.updateAppWidget(id, views);
        }
    }
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { refresh(context); }
}
