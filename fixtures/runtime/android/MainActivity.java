package dev.mobilemirror.runtimefixture;

import android.app.Activity;
import android.os.Bundle;
import android.os.Handler;
import android.content.SharedPreferences;
import android.widget.*;

/** Dedicated synthetic temporal/persistence fixture; no production data or network. */
public class MainActivity extends Activity {
  private TextView status;
  private SharedPreferences preferences;
  private Handler handler = new Handler();
  private boolean destroyed = false;
  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    preferences = getSharedPreferences("runtime-fixture", MODE_PRIVATE);
    LinearLayout column = new LinearLayout(this);
    column.setOrientation(LinearLayout.VERTICAL); column.setPadding(32, 48, 32, 24);
    TextView title = new TextView(this); title.setText("Mirror Runtime Fixture"); title.setTextSize(24); column.addView(title);
    status = new TextView(this); status.setContentDescription("runtime.status");
    status.setText(preferences.getBoolean("loss", false) ? "Data lost" : preferences.getString("saved", "Ready"));
    column.addView(status);
    button(column, "runtime.delay", "Delayed success", () -> {
      status.setText("Pending");
      // Keep the negative state observable through real device checkpoint overhead.
      handler.postDelayed(() -> { if (!destroyed) status.setText("Complete"); }, 5000);
    });
    button(column, "runtime.blink", "Blink once", () -> {
      status.setText("Complete");
      handler.postDelayed(() -> { if (!destroyed) status.setText("Counterexample"); }, 6000);
      handler.postDelayed(() -> { if (!destroyed) status.setText("Complete"); }, 10000);
    });
    button(column, "runtime.save", "Save fixed value", () -> {
      preferences.edit().putString("saved", "Saved 1200").putBoolean("loss", false).commit();
      status.setText("Saved 1200");
    });
    button(column, "runtime.loss", "Lose value on next restart", () -> {
      preferences.edit().putBoolean("loss", true).commit(); status.setText("Saved 1200");
    });
    setContentView(column);
  }
  private void button(LinearLayout column, String id, String label, Runnable action) {
    Button button = new Button(this); button.setText(label); button.setContentDescription(id);
    button.setOnClickListener(view -> action.run()); column.addView(button);
  }
  @Override public void onDestroy() { destroyed = true; handler.removeCallbacksAndMessages(null); super.onDestroy(); }
}
