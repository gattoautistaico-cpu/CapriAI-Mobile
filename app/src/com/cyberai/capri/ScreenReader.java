package com.cyberai.capri;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.util.Base64;
import android.view.Display;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import java.io.ByteArrayOutputStream;

/**
 * Servizio di accessibilità: legge il testo della finestra in primo piano
 * (solo quando Capri lo chiede) e, su Android 11+, fa uno screenshot per la visione.
 * Non registra nulla in automatico: gli eventi vengono ignorati.
 */
public class ScreenReader extends AccessibilityService {
    static ScreenReader self;
    static String lastPkg = "";

    public interface ShotCb {
        void done(String base64Jpeg);
    }

    @Override
    protected void onServiceConnected() {
        self = this;
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent e) {
        try {
            if (e != null && e.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED && e.getPackageName() != null) {
                String p = e.getPackageName().toString();
                if (!p.equals(getPackageName()) && !p.equals("com.android.systemui")) lastPkg = p;
            }
        } catch (Throwable ignored) {
        }
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        self = null;
        super.onDestroy();
    }

    static boolean enabled() {
        return self != null;
    }

    /** Testo visibile della finestra attiva (escluse la bolla e Capri stessa), max ~8000 caratteri. */
    static String readScreen() {
        ScreenReader s = self;
        if (s == null) return null;
        StringBuilder sb = new StringBuilder();
        try {
            AccessibilityNodeInfo root = null;
            // la finestra attiva potrebbe essere la nostra bolla: cerca quella dell'app sotto
            if (Build.VERSION.SDK_INT >= 21) {
                for (android.view.accessibility.AccessibilityWindowInfo w : s.getWindows()) {
                    AccessibilityNodeInfo r = w.getRoot();
                    if (r == null) continue;
                    CharSequence pkg = r.getPackageName();
                    if (pkg != null && (pkg.toString().equals(s.getPackageName()) || pkg.toString().equals("com.android.systemui"))) continue;
                    if (w.getType() == android.view.accessibility.AccessibilityWindowInfo.TYPE_APPLICATION) {
                        root = r;
                        break;
                    }
                }
            }
            if (root == null) root = s.getRootInActiveWindow();
            if (root == null) return "";
            CharSequence pkg = root.getPackageName();
            sb.append("[app: ").append(pkg == null ? lastPkg : pkg).append("]\n");
            walk(root, sb, 0);
        } catch (Throwable t) {
            sb.append("[errore lettura: ").append(t.getClass().getSimpleName()).append("]");
        }
        String out = sb.toString();
        return out.length() > 8000 ? out.substring(0, 8000) + "\n[…troncato]" : out;
    }

    static void walk(AccessibilityNodeInfo n, StringBuilder sb, int depth) {
        if (n == null || depth > 40 || sb.length() > 9000) return;
        try {
            if (n.isVisibleToUser()) {
                CharSequence t = n.getText();
                CharSequence d = n.getContentDescription();
                String txt = t != null ? t.toString().trim() : "";
                String des = d != null ? d.toString().trim() : "";
                if (n.isPassword()) txt = "[password]";
                if (!txt.isEmpty()) sb.append(txt).append('\n');
                else if (!des.isEmpty() && des.length() < 200) sb.append('(').append(des).append(")\n");
            }
            for (int i = 0; i < n.getChildCount(); i++) walk(n.getChild(i), sb, depth + 1);
        } catch (Throwable ignored) {
        }
    }

    /** Screenshot (Android 11+), ridotto a 1024 px di larghezza, JPEG base64. */
    static boolean screenshot(final ShotCb cb) {
        final ScreenReader s = self;
        if (s == null || Build.VERSION.SDK_INT < 30) return false;
        try {
            s.takeScreenshot(Display.DEFAULT_DISPLAY, s.getMainExecutor(), new TakeScreenshotCallback() {
                @Override
                public void onSuccess(ScreenshotResult r) {
                    try {
                        HardwareBuffer hb = r.getHardwareBuffer();
                        Bitmap hw = Bitmap.wrapHardwareBuffer(hb, r.getColorSpace());
                        Bitmap bm = hw.copy(Bitmap.Config.ARGB_8888, false);
                        hb.close();
                        int w = bm.getWidth(), h = bm.getHeight();
                        if (w > 1024) {
                            bm = Bitmap.createScaledBitmap(bm, 1024, Math.max(1, h * 1024 / w), true);
                        }
                        ByteArrayOutputStream o = new ByteArrayOutputStream();
                        bm.compress(Bitmap.CompressFormat.JPEG, 70, o);
                        cb.done(Base64.encodeToString(o.toByteArray(), Base64.NO_WRAP));
                    } catch (Throwable t) {
                        cb.done("");
                    }
                }

                @Override
                public void onFailure(int code) {
                    cb.done("");
                }
            });
            return true;
        } catch (Throwable t) {
            return false;
        }
    }
}
