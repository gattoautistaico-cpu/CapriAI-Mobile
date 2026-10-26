package com.cyberai.capri;

import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import java.util.ArrayList;

/**
 * Riconoscimento vocale robusto, usato sia dall'Activity sia dalla bolla.
 * - ricrea il recognizer a ogni sessione (evita ERROR_RECOGNIZER_BUSY / ERROR_CLIENT)
 * - watchdog: se il servizio non risponde entro 12 s chiude con errore "timeout"
 * - ritenta una volta su errori transitori (busy, client, server)
 * - se c'è un risultato parziale e poi arriva "no match", usa il parziale
 */
public class Stt {
    public interface Cb {
        void onState(String ev, String value); // ready | rms | partial | end | final | error
    }

    final Context ctx;
    final Cb cb;
    final Handler h = new Handler(Looper.getMainLooper());
    SpeechRecognizer rec;
    String lang = "it-IT";
    String lastPartial = "";
    boolean active = false;
    int retries = 0;
    long lastEvent = 0;

    final Runnable watchdog = new Runnable() {
        public void run() {
            if (!active) return;
            if (System.currentTimeMillis() - lastEvent > 12000) {
                finishWith("error", "timeout");
            } else {
                h.postDelayed(this, 1000);
            }
        }
    };

    public Stt(Context c, Cb cb) {
        this.ctx = c;
        this.cb = cb;
    }

    public static boolean available(Context c) {
        try {
            return SpeechRecognizer.isRecognitionAvailable(c);
        } catch (Throwable t) {
            return false;
        }
    }

    public void start(String language) {
        lang = language == null || language.isEmpty() ? "it-IT" : language;
        retries = 0;
        lastPartial = "";
        begin();
    }

    void begin() {
        destroyRec();
        if (!available(ctx)) {
            cb.onState("error", "unavailable");
            return;
        }
        try {
            rec = SpeechRecognizer.createSpeechRecognizer(ctx);
            rec.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { mark(); cb.onState("ready", ""); }
                @Override public void onBeginningOfSpeech() { mark(); }
                @Override public void onRmsChanged(float v) { mark(); cb.onState("rms", String.valueOf(v)); }
                @Override public void onBufferReceived(byte[] b) { mark(); }
                @Override public void onEndOfSpeech() { mark(); cb.onState("end", ""); }
                @Override public void onEvent(int t, Bundle b) {}

                @Override
                public void onError(int e) {
                    if (!active) return;
                    // 5 client, 8 busy, 4 server, 2 network, 1 network timeout: un tentativo in più
                    if ((e == 5 || e == 8 || e == 4 || e == 2 || e == 1) && retries < 1) {
                        retries++;
                        h.postDelayed(new Runnable() { public void run() { if (active) begin(); } }, 350);
                        return;
                    }
                    // nessun match ma avevo un parziale: lo uso
                    if ((e == 7 || e == 6) && lastPartial.length() > 0) {
                        finishWith("final", lastPartial);
                        return;
                    }
                    finishWith("error", String.valueOf(e));
                }

                @Override
                public void onResults(Bundle r) {
                    String best = "";
                    try {
                        ArrayList<String> m = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (m != null && !m.isEmpty() && m.get(0) != null) best = m.get(0);
                    } catch (Throwable ignored) {
                    }
                    if (best.trim().isEmpty()) best = lastPartial;
                    if (best.trim().isEmpty()) finishWith("error", "7");
                    else finishWith("final", best);
                }

                @Override
                public void onPartialResults(Bundle r) {
                    mark();
                    try {
                        ArrayList<String> m = r.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        if (m != null && !m.isEmpty() && m.get(0) != null && !m.get(0).isEmpty()) {
                            lastPartial = m.get(0);
                            cb.onState("partial", lastPartial);
                        }
                    } catch (Throwable ignored) {
                    }
                }
            });
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
            i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, ctx.getPackageName());
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L);
            i.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 1000L);
            active = true;
            mark();
            h.removeCallbacks(watchdog);
            h.postDelayed(watchdog, 1000);
            rec.startListening(i);
        } catch (Throwable t) {
            finishWith("error", "start:" + t.getClass().getSimpleName());
        }
    }

    void mark() {
        lastEvent = System.currentTimeMillis();
    }

    void finishWith(String ev, String v) {
        if (!active) return;
        active = false;
        h.removeCallbacks(watchdog);
        final SpeechRecognizer old = rec;
        rec = null;
        // distruggere dentro il callback può dare errori: lo facciamo subito dopo
        h.post(new Runnable() {
            public void run() {
                try { if (old != null) old.destroy(); } catch (Throwable ignored) {}
            }
        });
        cb.onState(ev, v);
    }

    /** Fine anticipata: usa il parziale se c'è. */
    public void stop() {
        if (!active) return;
        try {
            if (rec != null) rec.stopListening();
        } catch (Throwable ignored) {
        }
        // se entro 2.5 s non arriva il risultato, chiudi col parziale
        h.postDelayed(new Runnable() {
            public void run() {
                if (!active) return;
                if (lastPartial.length() > 0) finishWith("final", lastPartial);
                else finishWith("error", "7");
            }
        }, 2500);
    }

    public void cancel() {
        if (!active) {
            destroyRec();
            return;
        }
        active = false;
        h.removeCallbacks(watchdog);
        destroyRec();
    }

    public boolean isActive() {
        return active;
    }

    void destroyRec() {
        if (rec != null) {
            try {
                rec.cancel();
                rec.destroy();
            } catch (Throwable ignored) {
            }
            rec = null;
        }
    }
}
