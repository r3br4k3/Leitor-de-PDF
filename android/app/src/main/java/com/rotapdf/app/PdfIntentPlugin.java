package com.rotapdf.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

@CapacitorPlugin(name = "PdfIntent")
public class PdfIntentPlugin extends Plugin {
    private static final String PREFS_NAME = "rotapdf_prefs";
    private static final String KEY_PENDING_PDF = "pending_pdf_payload";

    static void storePendingPdf(Context context, String payload) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putString(KEY_PENDING_PDF, payload).apply();
    }

    @PluginMethod
    public void getPendingPdf(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String payload = prefs.getString(KEY_PENDING_PDF, null);

        JSObject result = new JSObject();
        result.put("hasPayload", payload != null);

        if (payload != null) {
            try {
                JSONObject json = new JSONObject(payload);
                result.put("data", JSObject.fromJSONObject(json));
            } catch (Exception ignored) {
                result.put("hasPayload", false);
            }
        }

        call.resolve(result);
    }

    @PluginMethod
    public void clearPendingPdf(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().remove(KEY_PENDING_PDF).apply();
        call.resolve();
    }
}
