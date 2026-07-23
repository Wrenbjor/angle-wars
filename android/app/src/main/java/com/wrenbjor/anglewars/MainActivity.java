package com.wrenbjor.anglewars;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Re-hide after the bars are transiently shown (user swipe) or a system
        // dialog steals focus, so the game stays fullscreen.
        if (hasFocus) {
            hideSystemBars();
        }
    }

    // Immersive fullscreen for a game: hide the status bar and the navigation
    // bar (back/home/menu) so they no longer overlay the play area. They return
    // transiently on an edge swipe (BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE), then
    // auto-hide again. Uses the modern androidx WindowInsetsController (no
    // deprecated system-UI flags), compatible with the edge-to-edge WebView.
    private void hideSystemBars() {
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
