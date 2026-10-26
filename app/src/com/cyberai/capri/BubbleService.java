package com.cyberai.capri;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.text.Layout;
import android.text.StaticLayout;
import android.text.TextPaint;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

/**
 * Bolla flottante sopra le altre app.
 * - tocco: ascolta direttamente dalla bolla (SpeechRecognizer nel servizio) e manda il testo al cervello
 * - doppio tocco: apre l'app completa
 * - tieni premuto: chiude la bolla
 * - trascina: sposta
 * Le risposte compaiono in un fumetto-terminale sopra il sigillo.
 */
public class BubbleService extends Service {
    static BubbleService self;
    static String label = "CAPRI // DORMANT";
    static int color = Color.rgb(155, 107, 255);
    static String sayUser = "", sayName = "CAPRI", sayText = "";

    WindowManager wm;
    SigilView view;
    WindowManager.LayoutParams lp;
    final Handler ui = new Handler(Looper.getMainLooper());
    Stt stt;
    float d;
    int anchorX, anchorY; // centro del sigillo in coordinate schermo
    int shown = 0;        // caratteri visibili (macchina da scrivere)
    long sayAt = 0;
    String localLabel = null; // etichetta locale durante l'ascolto dalla bolla
    String partial = "";

    static final int SIG_W = 150, SIG_H = 130, PANEL_W = 300;

    // ------------------------------------------------------------ assistente passivo
    static volatile boolean passiveWanted = false;
    static String wakeWords = "hey capri";
    static boolean en = false;
    static String L(String it, String eng) { return en ? eng : it; }
    static String greeting = "";
    static volatile boolean speaking = false;
    static volatile boolean muteBeep = true;
    boolean muted = false;

    /** Silenzia i "bip" del riconoscitore durante l'ascolto passivo (stream di sistema/notifiche). */
    void setMuted(boolean on) {
        if (on == muted) return;
        if (on && !muteBeep) return;
        try {
            android.media.AudioManager am = (android.media.AudioManager) getSystemService(Context.AUDIO_SERVICE);
            int dir = on ? android.media.AudioManager.ADJUST_MUTE : android.media.AudioManager.ADJUST_UNMUTE;
            am.adjustStreamVolume(android.media.AudioManager.STREAM_SYSTEM, dir, 0);
            am.adjustStreamVolume(android.media.AudioManager.STREAM_NOTIFICATION, dir, 0);
            muted = on;
        } catch (Throwable ignored) {
            muted = false;
        }
    }
    boolean passive = false;
    String mode = "idle"; // idle | wake | command

    static void setPassive(final boolean on) {
        final BubbleService s = self;
        if (s == null) return;
        s.ui.post(new Runnable() { public void run() { s.passive = on; if (on) s.resumeWakeSoon(400); else { if ("wake".equals(s.mode)) { s.stt.cancel(); s.mode = "idle"; } s.setMuted(false); s.relayout(); } } });
    }

    static void setSpeaking(final boolean on) {
        speaking = on;
        final BubbleService s = self;
        if (s == null) return;
        s.ui.post(new Runnable() { public void run() {
            if (on && "wake".equals(s.mode)) { s.stt.cancel(); s.mode = "idle"; }
            if (!on) s.resumeWakeSoon(700);
        } });
    }

    final Runnable wakeLoop = new Runnable() {
        public void run() {
            if (!passive || speaking || stt == null || stt.isActive()) return;
            MainActivity a = MainActivity.instance;
            if (a != null && a.stt != null && a.stt.isActive()) { resumeWakeSoon(1500); return; }
            mode = "wake";
            localLabel = null;
            setMuted(true);
            stt.start(a != null ? a.currentLang : "it-IT");
            if (view != null) view.invalidate();
        }
    };

    void resumeWakeSoon(long ms) {
        ui.removeCallbacks(wakeLoop);
        if (passive) ui.postDelayed(wakeLoop, ms);
    }

    /** Ritorna il comando dopo la parola di attivazione ("" = solo attivazione), null = nessuna attivazione. */
    String matchWake(String heard) {
        String h = Tools.norm(heard);
        if (h.isEmpty()) return null;
        for (String w0 : wakeWords.split(",")) {
            String w = Tools.norm(w0);
            if (w.isEmpty()) continue;
            int i = h.indexOf(w);
            int len = w.length();
            if (i < 0) {
                // tollera "ehi/hei/ok" diversi: basta l'ultima parola significativa (es. "capri")
                String[] parts = w.split(" ");
                String key = parts[parts.length - 1];
                if (key.length() >= 4) {
                    i = h.indexOf(key);
                    len = key.length();
                }
            }
            if (i >= 0) return h.substring(Math.min(h.length(), i + len)).trim();
        }
        return null;
    }

    // ------------------------------------------------------------ API statiche (chiamate dalla WebView)

    static void setState(final String l, final String c) {
        label = l;
        try {
            color = Color.parseColor(c);
        } catch (Exception ignored) {
        }
        final BubbleService s = self;
        if (s != null) s.ui.post(new Runnable() { public void run() { if (s.view != null) s.view.invalidate(); } });
    }

    static void say(final String user, final String name, final String text) {
        final BubbleService s = self;
        if (s == null) return;
        s.ui.post(new Runnable() {
            public void run() {
                boolean newText = !text.equals(sayText);
                sayUser = user == null ? "" : user;
                sayName = name == null || name.isEmpty() ? "CAPRI" : name;
                sayText = text == null ? "" : text;
                if (newText) s.shown = 0;
                s.sayAt = System.currentTimeMillis();
                s.relayout();
            }
        });
    }

    static void stopBubbleListening() {
        final BubbleService s = self;
        if (s != null && s.stt != null) s.ui.post(new Runnable() { public void run() { s.stt.cancel(); s.mode = "idle"; s.localLabel = null; s.relayout(); s.resumeWakeSoon(8000); } });
    }

    // ------------------------------------------------------------ ciclo di vita

    @Override
    public IBinder onBind(Intent i) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        self = this;
        try {
            startForeground(7, buildNotification());
        } catch (Throwable ignored) {
        }
        d = getResources().getDisplayMetrics().density;
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        view = new SigilView(this);
        int type = Build.VERSION.SDK_INT >= 26 ? WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY : WindowManager.LayoutParams.TYPE_PHONE;
        lp = new WindowManager.LayoutParams(dp(SIG_W), dp(SIG_H), type,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        anchorX = getResources().getDisplayMetrics().widthPixels - dp(80);
        anchorY = (int) (getResources().getDisplayMetrics().heightPixels * 0.62f);
        applyLayout();
        try {
            wm.addView(view, lp);
        } catch (Throwable t) {
            stopSelf();
            return;
        }
        stt = new Stt(this, new Stt.Cb() {
            public void onState(String ev, String v) {
                onStt(ev, v);
            }
        });
        view.setOnTouchListener(new View.OnTouchListener() {
            float sx, sy;
            int ax, ay;
            long down, lastTap;
            boolean moved;
            final Runnable longPress = new Runnable() { public void run() { if (!moved) stopSelf(); } };

            @Override
            public boolean onTouch(View v, MotionEvent e) {
                switch (e.getAction()) {
                    case MotionEvent.ACTION_DOWN:
                        sx = e.getRawX();
                        sy = e.getRawY();
                        ax = anchorX;
                        ay = anchorY;
                        down = System.currentTimeMillis();
                        moved = false;
                        ui.postDelayed(longPress, 800);
                        return true;
                    case MotionEvent.ACTION_MOVE:
                        float dx = e.getRawX() - sx, dy = e.getRawY() - sy;
                        if (Math.abs(dx) + Math.abs(dy) > dp(10)) {
                            moved = true;
                            ui.removeCallbacks(longPress);
                        }
                        if (moved) {
                            anchorX = ax + (int) dx;
                            anchorY = ay + (int) dy;
                            applyLayout();
                            safeUpdate();
                        }
                        return true;
                    case MotionEvent.ACTION_UP:
                    case MotionEvent.ACTION_CANCEL:
                        ui.removeCallbacks(longPress);
                        if (!moved && System.currentTimeMillis() - down < 800) {
                            long t = System.currentTimeMillis();
                            if (t - lastTap < 320) {
                                lastTap = 0;
                                ui.removeCallbacks(singleTap);
                                openApp(false);
                            } else {
                                lastTap = t;
                                ui.postDelayed(singleTap, 330);
                            }
                        }
                        return true;
                    default:
                        return false;
                }
            }
        });
        ui.post(typer);
        if (passiveWanted) {
            passive = true;
            resumeWakeSoon(800);
        }
    }

    final Runnable singleTap = new Runnable() {
        public void run() {
            talk();
        }
    };

    /** Macchina da scrivere + auto-chiusura del fumetto. */
    final Runnable typer = new Runnable() {
        public void run() {
            if (view == null) return;
            if (shown < sayText.length()) {
                shown = Math.min(sayText.length(), shown + 2);
                view.invalidate();
            }
            long life = 9000 + sayText.length() * 60L;
            if (!sayText.isEmpty() && localLabel == null && System.currentTimeMillis() - sayAt > life && !label.contains("TALKING") && !label.contains("THINKING")) {
                sayText = "";
                sayUser = "";
                relayout();
            }
            ui.postDelayed(this, 45);
        }
    };

    void talk() {
        if (stt.isActive() && !"wake".equals(mode)) {
            stt.stop();
            return;
        }
        if ("wake".equals(mode)) stt.cancel();
        boolean mic = Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        if (!mic || !Stt.available(this)) {
            openApp(true); // l'app chiede il permesso o mostra l'errore
            return;
        }
        MainActivity a = MainActivity.instance;
        if (a != null) a.js("window.capriStopVoice&&capriStopVoice()");
        partial = "";
        ui.removeCallbacks(wakeLoop);
        mode = "command";
        localLabel = sayName.toUpperCase() + " // LISTENING";
        sayUser = "";
        sayText = L("ti ascolto…", "listening…");
        shown = sayText.length();
        sayAt = System.currentTimeMillis();
        relayout();
        String lang = a != null ? a.currentLang : "it-IT";
        stt.start(lang);
    }

    void onStt(String ev, String v) {
        if ("wake".equals(mode)) {
            onWakeStt(ev, v);
            return;
        }
        if ("final".equals(ev) || "error".equals(ev)) {
            mode = "idle";
            resumeWakeSoon(2500);
        }
        if ("partial".equals(ev)) {
            partial = v;
            sayText = v;
            shown = v.length();
            relayout();
        } else if ("final".equals(ev)) {
            localLabel = null;
            sayUser = v;
            sayText = "decrypting ▮▯▯";
            shown = sayText.length();
            sayAt = System.currentTimeMillis();
            relayout();
            sendToBrain(v);
        } else if ("error".equals(ev)) {
            localLabel = null;
            String msg;
            if ("7".equals(v) || "6".equals(v) || "timeout".equals(v)) msg = L("non ho sentito niente, choom. tocca e riprova.", "didn't hear a thing, choom. tap and try again.");
            else if ("unavailable".equals(v)) msg = L("riconoscimento vocale non disponibile: installa o aggiorna l'app Google.", "speech recognition unavailable: install or update the Google app.");
            else if ("9".equals(v)) msg = L("mi manca il permesso del microfono: apri l'app.", "microphone permission missing: open the app.");
            else msg = L("errore microfono (", "microphone error (") + v + L("). tocca e riprova.", "). tap and try again.");
            sayUser = "";
            sayText = msg;
            shown = 0;
            sayAt = System.currentTimeMillis();
            relayout();
        } else if ("rms".equals(ev) && view != null) {
            try {
                view.level = Math.max(0, Math.min(1, (Float.parseFloat(v) + 2) / 12f));
            } catch (Exception ignored) {
            }
            view.invalidate();
        }
    }

    void onWakeStt(String ev, String v) {
        if ("rms".equals(ev)) return;
        if ("partial".equals(ev) || "final".equals(ev)) {
            String cmd = matchWake(v);
            if (cmd != null) {
                stt.cancel();
                mode = "idle";
                setMuted(false);
                onWake(cmd);
                return;
            }
        }
        if ("final".equals(ev) || "error".equals(ev)) {
            mode = "idle";
            // "unavailable" o permesso mancante: inutile ripetere a raffica
            boolean fatal = "unavailable".equals(v) || "9".equals(v);
            if (fatal) {
                passive = false;
                sayUser = "";
                sayText = L("modalità passiva sospesa: riconoscimento vocale non disponibile.", "passive mode paused: speech recognition unavailable.");
                shown = 0;
                sayAt = System.currentTimeMillis();
                relayout();
            } else {
                resumeWakeSoon("final".equals(ev) ? 150 : 400);
            }
        }
    }

    /** Parola di attivazione sentita: popup + domanda, oppure comando diretto. */
    void onWake(String cmd) {
        if (cmd != null && cmd.length() > 3) {
            sayUser = cmd;
            sayText = "decrypting ▮▯▯";
            shown = sayText.length();
            sayAt = System.currentTimeMillis();
            relayout();
            sendToBrain(cmd);
            return;
        }
        String g = greeting == null || greeting.isEmpty() ? L("Dimmi, choom. Di cosa hai bisogno?", "Talk to me, choom. What do you need?") : greeting;
        sayUser = "";
        sayText = g;
        shown = 0;
        sayAt = System.currentTimeMillis();
        relayout();
        MainActivity a = MainActivity.instance;
        long wait = 600;
        if (a != null) {
            a.js("window.capriGreet&&capriGreet(" + MainActivity.q(g) + ")");
            wait = 700 + g.length() * 55L; // aspetta che finisca di parlare prima di ascoltare
        }
        ui.postDelayed(new Runnable() { public void run() { talk(); } }, wait);
    }

    void sendToBrain(String text) {
        MainActivity a = MainActivity.instance;
        if (a != null) {
            a.askFromBubble(text);
        } else {
            // app chiusa dal sistema: la riapro in background con la domanda
            Intent i = new Intent(this, MainActivity.class);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            i.putExtra("ask", text);
            i.putExtra("background", true);
            try {
                startActivity(i);
            } catch (Throwable t) {
                sayText = L("non riesco a svegliare l'app: aprila una volta.", "can't wake the app: open it once.");
                shown = 0;
                relayout();
            }
        }
    }

    void openApp(boolean listen) {
        Intent i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        i.putExtra("listen", listen);
        try {
            startActivity(i);
        } catch (Throwable ignored) {
        }
    }

    // ------------------------------------------------------------ layout

    int dp(float v) {
        return (int) (v * d);
    }

    boolean panelVisible() {
        return !sayText.isEmpty();
    }

    int panelHeight() {
        if (!panelVisible()) return 0;
        return view == null ? dp(90) : view.panelHeight(dp(PANEL_W) - dp(28));
    }

    void applyLayout() {
        int w = panelVisible() ? dp(PANEL_W) : dp(SIG_W);
        int ph = panelHeight();
        int h = dp(SIG_H) + ph;
        int sw = getResources().getDisplayMetrics().widthPixels;
        int shh = getResources().getDisplayMetrics().heightPixels;
        lp.width = w;
        lp.height = h;
        // il sigillo sta in basso al centro della finestra
        lp.x = Math.max(0, Math.min(sw - w, anchorX - w / 2));
        lp.y = Math.max(0, Math.min(shh - h, anchorY - ph - dp(46)));
        if (view != null) view.sigilCx = anchorX - lp.x;
    }

    void safeUpdate() {
        try {
            if (view != null && view.isAttachedToWindow()) wm.updateViewLayout(view, lp);
        } catch (Throwable ignored) {
        }
    }

    void relayout() {
        if (view == null) return;
        applyLayout();
        safeUpdate();
        view.invalidate();
    }

    Notification buildNotification() {
        String ch = "capri";
        Notification.Builder b;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            NotificationChannel c = new NotificationChannel(ch, "Capri online", NotificationManager.IMPORTANCE_MIN);
            nm.createNotificationChannel(c);
            b = new Notification.Builder(this, ch);
        } else {
            b = new Notification.Builder(this);
        }
        Intent i = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, i, Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return b.setContentTitle("Capri online")
                .setContentText(passiveWanted ? L("In ascolto della parola di attivazione", "Listening for the wake word") : L("Tocca = parla · doppio tocco = apri · tieni premuto = chiudi", "Tap = talk · double tap = open · long press = close"))
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentIntent(pi)
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (stt != null) stt.cancel();
        setMuted(false);
        try {
            if (view != null) wm.removeView(view);
        } catch (Throwable ignored) {
        }
        view = null;
        self = null;
        super.onDestroy();
    }

    // ------------------------------------------------------------ disegno

    class SigilView extends View {
        final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        final TextPaint tp = new TextPaint(Paint.ANTI_ALIAS_FLAG);
        float rot = 0, level = 0;
        int sigilCx = 0;

        SigilView(Context c) {
            super(c);
            p.setTypeface(Typeface.MONOSPACE);
            tp.setTypeface(Typeface.MONOSPACE);
            postOnAnimation(tick);
        }

        final Runnable tick = new Runnable() {
            public void run() {
                rot = (rot + 1.2f) % 360;
                invalidate();
                postOnAnimationDelayed(this, 33);
            }
        };

        StaticLayout layout(String s, int w, float size, int col, boolean italic) {
            tp.setTextSize(size * d);
            tp.setColor(col);
            tp.setTypeface(Typeface.create(Typeface.MONOSPACE, italic ? Typeface.ITALIC : Typeface.NORMAL));
            return new StaticLayout(s, tp, Math.max(10, w), Layout.Alignment.ALIGN_NORMAL, 1.1f, 0, false);
        }

        int panelHeight(int w) {
            int h = dp(16);
            if (!sayUser.isEmpty()) h += layout("> you: " + sayUser, w, 11, 0, true).getHeight() + dp(4);
            h += dp(16); // nome
            int lines = layout(sayText, w - dp(10), 14, 0, false).getHeight();
            h += Math.min(lines, dp(150)) + dp(20); // testo + coda
            return h;
        }

        @Override
        protected void onDraw(Canvas cv) {
            int col = color;
            String lab = localLabel != null ? localLabel : label;
            if (localLabel == null && "wake".equals(mode)) lab = lab + " ·";
            if (localLabel != null) col = Color.rgb(0, 240, 255);
            float W = getWidth();
            float ph = panelVisible() ? panelHeight(dp(PANEL_W) - dp(28)) : 0;

            // ---------- fumetto terminale
            if (ph > 0) {
                float left = dp(4), top = dp(2), right = W - dp(4), bottom = ph - dp(14);
                Path box = new Path();
                float k = dp(10);
                box.moveTo(left, top);
                box.lineTo(right - k, top);
                box.lineTo(right, top + k);
                box.lineTo(right, bottom - k);
                box.lineTo(right - k, bottom);
                box.lineTo(left, bottom);
                box.close();
                p.setStyle(Paint.Style.FILL);
                p.setColor(Color.argb(245, 11, 12, 18));
                cv.drawPath(box, p);
                p.setStyle(Paint.Style.STROKE);
                p.setStrokeWidth(2 * d);
                p.setColor(Color.rgb(0, 240, 255));
                cv.drawPath(box, p);
                // coda verso il sigillo
                Path tail = new Path();
                float tx = Math.max(left + dp(20), Math.min(right - dp(30), sigilCx));
                tail.moveTo(tx - dp(10), bottom);
                tail.lineTo(tx + dp(10), bottom);
                tail.lineTo(tx + dp(10), bottom + dp(12));
                tail.close();
                p.setStyle(Paint.Style.FILL);
                p.setColor(Color.rgb(0, 240, 255));
                cv.drawPath(tail, p);

                float x = left + dp(10), y = top + dp(8);
                int tw = (int) (right - x - dp(8));
                if (!sayUser.isEmpty()) {
                    StaticLayout u = layout("> you: " + sayUser, tw, 11, Color.rgb(138, 143, 156), true);
                    cv.save();
                    cv.translate(x, y);
                    u.draw(cv);
                    cv.restore();
                    y += u.getHeight() + dp(4);
                }
                p.setColor(Color.rgb(255, 31, 75));
                float barTop = y;
                tp.setTextSize(11 * d);
                tp.setFakeBoldText(true);
                tp.setColor(Color.rgb(252, 238, 10));
                cv.drawText(sayName.toUpperCase() + " >", x + dp(8), y + dp(11), tp);
                tp.setFakeBoldText(false);
                y += dp(16);
                String vis = sayText.substring(0, Math.min(shown, sayText.length()));
                boolean typing = shown < sayText.length();
                StaticLayout t = layout(vis + (typing || (System.currentTimeMillis() / 480) % 2 == 0 ? "█" : " "), tw - dp(10), 14, Color.rgb(242, 240, 230), false);
                cv.save();
                cv.clipRect(x, y, right, bottom - dp(4));
                cv.translate(x + dp(8), y);
                t.draw(cv);
                cv.restore();
                float textH = Math.min(t.getHeight(), dp(150));
                cv.drawRect(x, barTop, x + dp(3), y + textH, p);
            }

            // ---------- sigillo
            float cx = sigilCx > 0 ? sigilCx : W / 2, cy = ph + dp(46), r = dp(34);
            p.setStyle(Paint.Style.FILL);
            p.setColor(Color.argb(60, Color.red(col), Color.green(col), Color.blue(col)));
            cv.drawCircle(cx, cy, r + dp(6) + level * dp(10), p);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(2.5f * d);
            p.setColor(col);
            cv.save();
            cv.rotate(rot, cx, cy);
            RectF o = new RectF(cx - r, cy - r, cx + r, cy + r);
            for (int i = 0; i < 12; i++) cv.drawArc(o, i * 30, 18, false, p);
            cv.restore();
            p.setColor(Color.rgb(255, 46, 136));
            p.setStrokeWidth(1.5f * d);
            cv.save();
            cv.rotate(-rot * 1.6f, cx, cy);
            float r2 = r * 0.66f;
            RectF o2 = new RectF(cx - r2, cy - r2, cx + r2, cy + r2);
            for (int i = 0; i < 18; i++) cv.drawArc(o2, i * 20, 6, false, p);
            cv.restore();
            Path dm = new Path();
            float k2 = r * 0.45f;
            dm.moveTo(cx, cy - k2);
            dm.lineTo(cx + k2, cy);
            dm.lineTo(cx, cy + k2);
            dm.lineTo(cx - k2, cy);
            dm.close();
            p.setStyle(Paint.Style.FILL);
            p.setColor(Color.rgb(10, 10, 15));
            cv.drawPath(dm, p);
            p.setStyle(Paint.Style.STROKE);
            p.setColor(col);
            p.setStrokeWidth(2 * d);
            cv.drawPath(dm, p);
            p.setStyle(Paint.Style.FILL);
            cv.drawCircle(cx, cy, dp(5), p);
            p.setColor(Color.WHITE);
            cv.drawCircle(cx + dp(1.5f), cy - dp(1.5f), dp(1.6f), p);

            // ---------- etichetta
            p.setTextSize(11 * d);
            p.setFakeBoldText(true);
            float lw = p.measureText(lab);
            float ty = cy + r + dp(22);
            RectF lb = new RectF(cx - lw / 2 - dp(6), ty - dp(13), cx + lw / 2 + dp(6), ty + dp(5));
            p.setColor(Color.argb(235, 8, 8, 14));
            cv.drawRect(lb, p);
            p.setStyle(Paint.Style.STROKE);
            p.setStrokeWidth(d);
            p.setColor(col);
            cv.drawRect(lb, p);
            p.setStyle(Paint.Style.FILL);
            cv.drawText(lab, cx - lw / 2, ty, p);
            p.setFakeBoldText(false);
        }
    }
}
