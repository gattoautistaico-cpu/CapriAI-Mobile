package com.cyberai.capri;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.view.KeyEvent;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
    static final String HOST = "capri.local";
    static MainActivity instance;

    WebView web;
    final Handler ui = new Handler(Looper.getMainLooper());
    final ExecutorService pool = Executors.newFixedThreadPool(4);
    TextToSpeech tts;
    boolean ttsReady = false;
    Stt stt;
    boolean pageReady = false;
    boolean bgAfterReady = false;
    String currentLang = "it-IT";
    boolean pendingWake = false;
    String pendingAsk = null;
    String pendingListenLang = null;
    ValueCallback<Uri[]> fileCb;
    static final int REQ_FILE = 11, REQ_MIC = 12, REQ_OVERLAY = 13, REQ_PERMS = 14;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        instance = this;
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        Window w = getWindow();
        w.setStatusBarColor(Color.rgb(7, 7, 12));
        w.setNavigationBarColor(Color.rgb(7, 7, 12));
        w.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);

        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(7, 7, 12));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                try {
                    InputStream in = getAssets().open("web" + path);
                    WebResourceResponse res = new WebResourceResponse(mime(path), "utf-8", in);
                    Map<String, String> h = new HashMap<>();
                    h.put("Cache-Control", "no-cache");
                    res.setResponseHeaders(h);
                    return res;
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openExternal(u.toString());
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "video/*"});
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(i, "Sprite"), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });
        setContentView(web);
        web.loadUrl("https://" + HOST + "/index.html");

        tts = new TextToSpeech(this, new TextToSpeech.OnInitListener() { public void onInit(int st) {
            ttsReady = st == TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String id) { BubbleService.setSpeaking(true); js("window.__tts&&__tts('start')"); }
                    @Override public void onDone(String id) { BubbleService.setSpeaking(false); js("window.__tts&&__tts('done')"); }
                    @Override public void onError(String id) { BubbleService.setSpeaking(false); js("window.__tts&&__tts('done')"); }
                });
            }
        }});
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        handleIntent(i);
    }

    void handleIntent(Intent i) {
        if (i == null) return;
        String ask = i.getStringExtra("ask");
        if (ask != null && !ask.isEmpty()) askFromBubble(ask);
        if (i.getBooleanExtra("listen", false)) {
            if (pageReady) js("window.capriWake&&capriWake(true)");
            else pendingWake = true; // la pagina non è ancora pronta: aspetta Native.ready()
        }
        if (i.getBooleanExtra("background", false)) {
            if (pageReady) moveTaskToBack(true);
            else bgAfterReady = true;
        }
        i.removeExtra("listen");
        i.removeExtra("background");
        i.removeExtra("ask");
    }

    static String mime(String p) {
        p = p.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    void js(final String code) {
        ui.post(new Runnable() { public void run() { if (web != null) web.evaluateJavascript(code, null); }});
    }

    static String q(String s) {
        return JSONObject.quote(s == null ? "" : s);
    }

    void openExternal(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) {
            toast("Nessuna app per: " + url);
        }
    }

    void toast(String t) {
        ui.post(new Runnable() { public void run() { Toast.makeText(MainActivity.this, t, Toast.LENGTH_SHORT).show(); }});
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE && fileCb != null) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    out = new Uri[n];
                    for (int k = 0; k < n; k++) out[k] = data.getClipData().getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    out = new Uri[]{data.getData()};
                }
            }
            fileCb.onReceiveValue(out);
            fileCb = null;
        }
        if (req == REQ_OVERLAY) {
            boolean ok = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(this);
            js("window.__bubble&&__bubble(" + ok + ")");
            if (ok) startBubble();
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] p, int[] g) {
        if (req == REQ_PERMS) {
            js("window.__perms&&__perms()");
            return;
        }
        if (req == REQ_MIC) {
            boolean ok = g.length > 0 && g[0] == PackageManager.PERMISSION_GRANTED;
            if (ok && pendingListenLang != null) startListening(pendingListenLang);
            else js("window.__stt&&__stt('error','permission')");
            pendingListenLang = null;
        }
    }

    // ------------------------------------------------------------ STT

    void startListening(String lang) {
        if (Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingListenLang = lang;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        BubbleService.stopBubbleListening();
        if (stt == null) {
            stt = new Stt(this, new Stt.Cb() {
                public void onState(String ev, String v) {
                    js("window.__stt&&__stt(" + q(ev) + "," + q(v) + ")");
                }
            });
        }
        stt.start(lang);
    }

    boolean micGranted() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    /** Chiamata dalla bolla: inoltra il testo al cervello nella WebView. */
    void askFromBubble(String text) {
        if (pageReady) js("window.capriAsk&&capriAsk(" + q(text) + ",'bubble')");
        else pendingAsk = text;
    }

    // ------------------------------------------------------------ bolla

    void startBubble() {
        Intent i = new Intent(this, BubbleService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(i);
        else startService(i);
    }

    // ------------------------------------------------------------ media

    void mediaKey(int code) {
        AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        long t = SystemClock.uptimeMillis();
        am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0));
        am.dispatchMediaKeyEvent(new KeyEvent(t, t, KeyEvent.ACTION_UP, code, 0));
    }

    boolean installed(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    @Override
    public void onBackPressed() {
        js("window.capriBack?capriBack():0");
    }

    void reallyBack() {
        moveTaskToBack(true);
    }

    @Override
    protected void onDestroy() {
        if (stt != null) stt.cancel();
        if (tts != null) tts.shutdown();
        pool.shutdownNow();
        instance = null;
        super.onDestroy();
    }

    // ============================================================ bridge JS

    class Bridge {
        /** HTTP senza CORS: risposta in window.__http(id, status, body). */
        @JavascriptInterface
        public void http(final String id, final String method, final String url, final String headersJson, final String body, final int timeoutMs) {
            pool.execute(new Runnable() { public void run() {
                int code = 0;
                String text = "";
                HttpURLConnection c = null;
                try {
                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setRequestMethod(method);
                    c.setConnectTimeout(Math.min(timeoutMs, 15000));
                    c.setReadTimeout(timeoutMs);
                    if (headersJson != null && !headersJson.isEmpty()) {
                        JSONObject h = new JSONObject(headersJson);
                        Iterator<String> it = h.keys();
                        while (it.hasNext()) {
                            String k = it.next();
                            c.setRequestProperty(k, h.getString(k));
                        }
                    }
                    if (body != null && !body.isEmpty() && !"GET".equals(method)) {
                        c.setDoOutput(true);
                        byte[] bb = body.getBytes("UTF-8");
                        c.setFixedLengthStreamingMode(bb.length);
                        OutputStream os = c.getOutputStream();
                        os.write(bb);
                        os.close();
                    }
                    code = c.getResponseCode();
                    InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                    text = in == null ? "" : readAll(in);
                } catch (Throwable e) {
                    code = 0;
                    text = e.getClass().getSimpleName() + ": " + e.getMessage();
                } finally {
                    try { if (c != null) c.disconnect(); } catch (Throwable ignored) {}
                }
                if (text.length() > 400000) text = text.substring(0, 400000);
                js("window.__http&&__http(" + q(id) + "," + code + "," + q(text) + ")");
            }});
        }

        @JavascriptInterface
        public void speak(final String text, final String lang, final float pitch, final float rate, final String voice) {
            ui.post(new Runnable() { public void run() {
                if (!ttsReady) {
                    js("window.__tts&&__tts('done')");
                    return;
                }
                Locale loc = Locale.forLanguageTag(lang);
                tts.setLanguage(loc);
                if (voice != null && !voice.isEmpty()) {
                    for (Voice v : tts.getVoices()) if (v.getName().equals(voice)) { tts.setVoice(v); break; }
                }
                tts.setPitch(pitch);
                tts.setSpeechRate(rate);
                Bundle p = new Bundle();
                tts.speak(text, TextToSpeech.QUEUE_FLUSH, p, "u" + SystemClock.uptimeMillis());
            }});
        }

        @JavascriptInterface
        public void stopSpeaking() {
            ui.post(new Runnable() { public void run() { if (tts != null) tts.stop(); js("window.__tts&&__tts('done')"); }});
        }

        @JavascriptInterface
        public String voices(String lang) {
            JSONArray a = new JSONArray();
            if (ttsReady && tts.getVoices() != null) {
                for (Voice v : tts.getVoices()) {
                    if (lang == null || lang.isEmpty() || v.getLocale().getLanguage().equals(lang)) a.put(v.getName());
                }
            }
            return a.toString();
        }

        @JavascriptInterface
        public void setLang(String lang) {
            if (lang != null && !lang.isEmpty()) currentLang = lang;
        }

        @JavascriptInterface
        public void listen(final String lang) {
            setLang(lang);
            ui.post(new Runnable() { public void run() {
                try { startListening(lang); } catch (Throwable t) { js("window.__stt&&__stt('error','start')"); }
            }});
        }

        @JavascriptInterface
        public void stopListening() {
            ui.post(new Runnable() { public void run() { if (stt != null) stt.stop(); }});
        }

        /** Musica: swiftFree (intent + deep link) o Spotify; ritorna il metodo usato. */
        @JavascriptInterface
        public String music(String provider, String action, String query) {
            boolean sw = installed("com.swiftfree") || installed("com.swiftfree.app");
            boolean useSwift = "swiftfree".equals(provider) || ("auto".equals(provider) && sw);
            if ("play".equals(action)) {
                if (useSwift) {
                    Intent b = new Intent("com.swiftfree.action.PLAY");
                    b.putExtra("query", query);
                    sendBroadcast(b);
                    openExternal("swiftfree://play?q=" + Uri.encode(query));
                    return "swiftfree";
                }
                openExternal("spotify:search:" + Uri.encode(query));
                ui.postDelayed(new Runnable() { public void run() { mediaKey(KeyEvent.KEYCODE_MEDIA_PLAY); }}, 3500);
                return "spotify";
            }
            if (useSwift) {
                Intent b = new Intent("com.swiftfree.action.CONTROL");
                b.putExtra("action", action);
                sendBroadcast(b);
            }
            switch (action) {
                case "pause": mediaKey(KeyEvent.KEYCODE_MEDIA_PAUSE); break;
                case "resume": mediaKey(KeyEvent.KEYCODE_MEDIA_PLAY); break;
                case "next": mediaKey(KeyEvent.KEYCODE_MEDIA_NEXT); break;
                case "prev": mediaKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS); break;
                default: break;
            }
            return useSwift ? "swiftfree" : "media";
        }

        @JavascriptInterface
        public void openUrl(String url) {
            if (url.startsWith("https://") || url.startsWith("spotify:") || url.startsWith("swiftfree:")) openExternal(url);
        }

        @JavascriptInterface
        public void bubble(boolean on) {
            ui.post(new Runnable() { public void run() {
                if (!on) {
                    stopService(new Intent(MainActivity.this, BubbleService.class));
                    return;
                }
                if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(MainActivity.this)) {
                    Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                    startActivityForResult(i, REQ_OVERLAY);
                    return;
                }
                startBubble();
                moveTaskToBack(true);
            }});
        }

        @JavascriptInterface
        public void ready() {
            ui.post(new Runnable() { public void run() {
                pageReady = true;
                if (bgAfterReady) {
                    bgAfterReady = false;
                    moveTaskToBack(true);
                }
                if (pendingAsk != null) {
                    js("window.capriAsk&&capriAsk(" + q(pendingAsk) + ",'bubble')");
                    pendingAsk = null;
                }
                if (pendingWake) {
                    pendingWake = false;
                    js("window.capriWake&&capriWake(true)");
                }
            }});
        }

        /** Testo mostrato nel fumetto della bolla: utente, nome, risposta. */
        @JavascriptInterface
        public void bubbleSay(String user, String name, String text) {
            BubbleService.say(user, name, text);
        }

        @JavascriptInterface
        public void bubbleState(String label, String color) {
            BubbleService.setState(label, color);
        }

        // ------------------------------------------------------------ strumenti telefono

        @JavascriptInterface
        public String apps() {
            return Tools.apps(MainActivity.this).toString();
        }

        @JavascriptInterface
        public String openApp(String name) {
            return Tools.openApp(MainActivity.this, name);
        }

        @JavascriptInterface
        public String youtube(String q) {
            return Tools.youtube(MainActivity.this, q);
        }

        @JavascriptInterface
        public String google(String q) {
            return Tools.google(MainActivity.this, q);
        }

        @JavascriptInterface
        public String contacts(String q) {
            return Tools.findContacts(MainActivity.this, q).toString();
        }

        @JavascriptInterface
        public String call(String number) {
            return Tools.call(MainActivity.this, number);
        }

        @JavascriptInterface
        public String waCall(String dataId, String number) {
            long id = 0;
            try { id = Long.parseLong(dataId); } catch (Exception ignored) {}
            return Tools.whatsappCall(MainActivity.this, id, number);
        }

        @JavascriptInterface
        public String waChat(String number, String text) {
            return Tools.whatsappChat(MainActivity.this, number, text);
        }

        @JavascriptInterface
        public String screenText() {
            String t = ScreenReader.readScreen();
            return t == null ? "" : t;
        }

        @JavascriptInterface
        public void screenshot(final String id) {
            boolean ok = ScreenReader.screenshot(new ScreenReader.ShotCb() {
                public void done(String b64) { js("window.__shot&&__shot(" + q(id) + "," + q(b64) + ")"); }
            });
            if (!ok) js("window.__shot&&__shot(" + q(id) + ",'')");
        }

        @JavascriptInterface
        public void openA11y() {
            ui.post(new Runnable() { public void run() {
                try {
                    Intent i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Throwable t) { MainActivity.this.toast("Apri Impostazioni > Accessibilità > Capri AI"); }
            }});
        }

        @JavascriptInterface
        public void requestPerms(final String csv) {
            ui.post(new Runnable() { public void run() {
                if (Build.VERSION.SDK_INT < 23) { js("window.__perms&&__perms()"); return; }
                try { requestPermissions(csv.split(","), REQ_PERMS); } catch (Throwable t) { js("window.__perms&&__perms()"); }
            }});
        }

        @JavascriptInterface
        public String permState() {
            try {
                JSONObject o = new JSONObject();
                o.put("mic", Tools.granted(MainActivity.this, Manifest.permission.RECORD_AUDIO));
                o.put("contacts", Tools.granted(MainActivity.this, Manifest.permission.READ_CONTACTS));
                o.put("call", Tools.granted(MainActivity.this, Manifest.permission.CALL_PHONE));
                o.put("overlay", Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(MainActivity.this));
                o.put("a11y", ScreenReader.enabled());
                o.put("shot", Build.VERSION.SDK_INT >= 30);
                o.put("whatsapp", Tools.installed(MainActivity.this, "com.whatsapp"));
                o.put("youtube", Tools.installed(MainActivity.this, "com.google.android.youtube"));
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }

        /** Modalità assistente passivo: ascolto continuo della parola di attivazione nella bolla. */
        @JavascriptInterface
        public void passiveMute(boolean on) {
            BubbleService.muteBeep = on;
        }

        @JavascriptInterface
        public void passive(final boolean on, final String wakeWords, final String greeting) {
            ui.post(new Runnable() { public void run() {
                BubbleService.passiveWanted = on;
                BubbleService.wakeWords = wakeWords == null ? "hey capri" : wakeWords;
                BubbleService.greeting = greeting == null ? "" : greeting;
                if (on) {
                    if (Build.VERSION.SDK_INT >= 23 && !Settings.canDrawOverlays(MainActivity.this)) {
                        Intent i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                        startActivityForResult(i, REQ_OVERLAY);
                        return;
                    }
                    BubbleService.passiveWanted = true;
                    startBubble();
                    BubbleService.setPassive(true);
                } else {
                    BubbleService.passiveWanted = false;
                    BubbleService.setPassive(false);
                }
            }});
        }

        @JavascriptInterface
        public void toast(String t) {
            MainActivity.this.toast(t);
        }

        @JavascriptInterface
        public void back() {
            ui.post(new Runnable() { public void run() { reallyBack(); }});
        }

        @JavascriptInterface
        public String info() {
            try {
                JSONObject o = new JSONObject();
                o.put("sdk", Build.VERSION.SDK_INT);
                o.put("model", Build.MODEL);
                o.put("swiftfree", installed("com.swiftfree") || installed("com.swiftfree.app"));
                o.put("spotify", installed("com.spotify.music"));
                o.put("stt", SpeechRecognizer.isRecognitionAvailable(MainActivity.this));
                return o.toString();
            } catch (Exception e) {
                return "{}";
            }
        }
    }

    static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        in.close();
        return o.toString("UTF-8");
    }
}
