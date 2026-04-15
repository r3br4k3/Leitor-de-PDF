package com.rotapdf.app;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {

	@Override
	protected void onCreate(Bundle savedInstanceState) {
		super.onCreate(savedInstanceState);
		handlePdfIntent(getIntent());
	}

	@Override
	protected void onNewIntent(Intent intent) {
		super.onNewIntent(intent);
		setIntent(intent);
		handlePdfIntent(intent);
	}

	private void handlePdfIntent(Intent intent) {
		if (intent == null) {
			return;
		}

		try {
			Uri uri = null;
			String action = intent.getAction();

			if (Intent.ACTION_VIEW.equals(action)) {
				uri = intent.getData();
			} else if (Intent.ACTION_SEND.equals(action)) {
				Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
				if (stream instanceof Uri) {
					uri = (Uri) stream;
				}
			}

			if (uri == null) {
				return;
			}

			String mimeType = getContentResolver().getType(uri);
			if (mimeType == null) {
				mimeType = "application/pdf";
			}

			String fileName = resolveFileName(uri);
			String base64Data = readUriAsBase64(uri);

			JSONObject payload = new JSONObject();
			payload.put("fileName", fileName);
			payload.put("mimeType", mimeType);
			payload.put("base64Data", base64Data);

			PdfIntentPlugin.storePendingPdf(this, payload.toString());
		} catch (Exception ignored) {
			// Mantem o app abrindo normalmente mesmo se um PDF falhar.
		}
	}

	private String resolveFileName(Uri uri) {
		Cursor cursor = null;
		try {
			cursor = getContentResolver().query(uri, null, null, null, null);
			if (cursor != null && cursor.moveToFirst()) {
				int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
				if (nameIndex >= 0) {
					return cursor.getString(nameIndex);
				}
			}
		} catch (Exception ignored) {
		} finally {
			if (cursor != null) {
				cursor.close();
			}
		}

		return "documento.pdf";
	}

	private String readUriAsBase64(Uri uri) throws Exception {
		InputStream inputStream = getContentResolver().openInputStream(uri);
		if (inputStream == null) {
			throw new IllegalStateException("Nao foi possivel abrir o arquivo PDF.");
		}

		try (InputStream stream = inputStream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
			byte[] buffer = new byte[8192];
			int read;
			while ((read = stream.read(buffer)) != -1) {
				output.write(buffer, 0, read);
			}
			return Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP);
		}
	}
}
