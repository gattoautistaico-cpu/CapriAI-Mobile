package com.cyberai.capri;

import android.Manifest;
import android.app.SearchManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.ContactsContract;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.Normalizer;
import java.util.List;
import java.util.Locale;

/** Azioni sul telefono richieste da Capri: app, YouTube, Google, contatti, chiamate, WhatsApp. */
public class Tools {

    static String norm(String s) {
        if (s == null) return "";
        String n = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}", "");
        return n.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    /** Punteggio di somiglianza semplice: uguale > inizia con > contiene > parole in comune. */
    static int score(String name, String q) {
        String a = norm(name), b = norm(q);
        if (a.isEmpty() || b.isEmpty()) return 0;
        if (a.equals(b)) return 100;
        if (a.startsWith(b) || b.startsWith(a)) return 80;
        if (a.contains(b) || b.contains(a)) return 60;
        int common = 0;
        for (String w : b.split(" ")) if (w.length() > 1 && a.contains(w)) common++;
        return common * 20;
    }

    static void start(Context c, Intent i) throws Exception {
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
    }

    // ------------------------------------------------------------ app

    static JSONArray apps(Context c) {
        JSONArray a = new JSONArray();
        try {
            PackageManager pm = c.getPackageManager();
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            List<ResolveInfo> l = pm.queryIntentActivities(i, 0);
            for (ResolveInfo r : l) {
                JSONObject o = new JSONObject();
                o.put("label", String.valueOf(r.loadLabel(pm)));
                o.put("pkg", r.activityInfo.packageName);
                o.put("cls", r.activityInfo.name);
                a.put(o);
            }
        } catch (Throwable ignored) {
        }
        return a;
    }

    /** Apre l'app che somiglia di più a `name`. Ritorna l'etichetta aperta o "" se non trovata. */
    static String openApp(Context c, String name) {
        try {
            JSONArray a = apps(c);
            int best = 0;
            JSONObject pick = null;
            for (int k = 0; k < a.length(); k++) {
                JSONObject o = a.getJSONObject(k);
                int s = Math.max(score(o.getString("label"), name), score(o.getString("pkg").replace('.', ' '), name) - 10);
                if (s > best) {
                    best = s;
                    pick = o;
                }
            }
            if (pick == null || best < 40) return "";
            Intent i = new Intent(Intent.ACTION_MAIN);
            i.addCategory(Intent.CATEGORY_LAUNCHER);
            i.setComponent(new ComponentName(pick.getString("pkg"), pick.getString("cls")));
            i.addFlags(Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            start(c, i);
            return pick.getString("label");
        } catch (Throwable t) {
            return "";
        }
    }

    // ------------------------------------------------------------ ricerca

    static String youtube(Context c, String q) {
        try {
            Intent i = new Intent(Intent.ACTION_SEARCH);
            i.setPackage("com.google.android.youtube");
            i.putExtra("query", q);
            start(c, i);
            return "youtube";
        } catch (Throwable t) {
            try {
                start(c, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=" + Uri.encode(q))));
                return "browser";
            } catch (Throwable t2) {
                return "";
            }
        }
    }

    static String google(Context c, String q) {
        try {
            Intent i = new Intent(Intent.ACTION_WEB_SEARCH);
            i.putExtra(SearchManager.QUERY, q);
            start(c, i);
            return "google";
        } catch (Throwable t) {
            try {
                start(c, new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/search?q=" + Uri.encode(q))));
                return "browser";
            } catch (Throwable t2) {
                return "";
            }
        }
    }

    // ------------------------------------------------------------ contatti

    static boolean granted(Context c, String perm) {
        return Build.VERSION.SDK_INT < 23 || c.checkSelfPermission(perm) == PackageManager.PERMISSION_GRANTED;
    }

    /** Contatti che somigliano a `q`: [{name, number, waVoiceId, waChatNumber}] (max 5). */
    static JSONArray findContacts(Context c, String q) {
        JSONArray out = new JSONArray();
        if (!granted(c, Manifest.permission.READ_CONTACTS)) return out;
        Cursor cur = null;
        try {
            cur = c.getContentResolver().query(ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                    new String[]{ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME, ContactsContract.CommonDataKinds.Phone.NUMBER, ContactsContract.CommonDataKinds.Phone.CONTACT_ID},
                    null, null, null);
            JSONArray all = new JSONArray();
            while (cur != null && cur.moveToNext()) {
                String name = cur.getString(0);
                int s = score(name, q);
                if (s >= 40) {
                    JSONObject o = new JSONObject();
                    o.put("name", name);
                    o.put("number", cur.getString(1));
                    o.put("contactId", cur.getLong(2));
                    o.put("score", s);
                    all.put(o);
                }
            }
            // ordina per punteggio, togli i doppioni per nome
            java.util.ArrayList<JSONObject> l = new java.util.ArrayList<>();
            for (int k = 0; k < all.length(); k++) l.add(all.getJSONObject(k));
            java.util.Collections.sort(l, new java.util.Comparator<JSONObject>() {
                public int compare(JSONObject x, JSONObject y) { return y.optInt("score") - x.optInt("score"); }
            });
            java.util.HashSet<String> seen = new java.util.HashSet<>();
            for (JSONObject o : l) {
                String key = o.getString("name") + "|" + norm(o.getString("number")).replace(" ", "");
                if (seen.contains(key)) continue;
                seen.add(key);
                o.put("waVoiceId", whatsappDataId(c, o.getLong("contactId"), "vnd.android.cursor.item/vnd.com.whatsapp.voip.call"));
                out.put(o);
                if (out.length() >= 5) break;
            }
        } catch (Throwable ignored) {
        } finally {
            if (cur != null) cur.close();
        }
        return out;
    }

    static long whatsappDataId(Context c, long contactId, String mime) {
        Cursor cur = null;
        try {
            cur = c.getContentResolver().query(ContactsContract.Data.CONTENT_URI, new String[]{ContactsContract.Data._ID},
                    ContactsContract.Data.CONTACT_ID + "=? AND " + ContactsContract.Data.MIMETYPE + "=?",
                    new String[]{String.valueOf(contactId), mime}, null);
            if (cur != null && cur.moveToFirst()) return cur.getLong(0);
        } catch (Throwable ignored) {
        } finally {
            if (cur != null) cur.close();
        }
        return 0;
    }

    /** Chiamata normale. Se manca CALL_PHONE apre il dialer con il numero (l'utente preme verde). */
    static String call(Context c, String number) {
        try {
            if (granted(c, Manifest.permission.CALL_PHONE)) {
                start(c, new Intent(Intent.ACTION_CALL, Uri.parse("tel:" + Uri.encode(number))));
                return "call";
            }
            start(c, new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number))));
            return "dial";
        } catch (Throwable t) {
            return "";
        }
    }

    /** Chiamata vocale WhatsApp dal contatto in rubrica; altrimenti apre la chat. */
    static String whatsappCall(Context c, long dataId, String number) {
        if (dataId > 0) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(Uri.parse("content://com.android.contacts/data/" + dataId), "vnd.android.cursor.item/vnd.com.whatsapp.voip.call");
                i.setPackage("com.whatsapp");
                start(c, i);
                return "wa_call";
            } catch (Throwable ignored) {
            }
        }
        return whatsappChat(c, number, "");
    }

    static String whatsappChat(Context c, String number, String text) {
        try {
            String n = number == null ? "" : number.replaceAll("[^0-9+]", "");
            if (n.startsWith("+")) n = n.substring(1);
            else if (n.startsWith("00")) n = n.substring(2);
            else if (n.length() == 10 && n.startsWith("3")) n = "39" + n; // cellulare italiano senza prefisso
            String url = "https://wa.me/" + n + (text != null && !text.isEmpty() ? "?text=" + Uri.encode(text) : "");
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            if (installed(c, "com.whatsapp")) i.setPackage("com.whatsapp");
            start(c, i);
            return "wa_chat";
        } catch (Throwable t) {
            return "";
        }
    }

    static boolean installed(Context c, String pkg) {
        try {
            c.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Throwable e) {
            return false;
        }
    }
}
