# Kadans

Persoonlijk dashboard bovenop COROS: training, slaap, herstel, progressie, een trainingsschema en een voedingslogboek.
Gewone HTML, CSS en JavaScript zonder build-stap. Draait op GitHub Pages met Firebase (Spark-plan) voor login en opslag.

## Lokaal draaien

```bash
node server.js
```

Surf naar <http://localhost:8080>. Met <http://localhost:8080/?demo> zie je de app met verzonnen data, zonder login.

## Opbouw

| Bestand | Wat |
|---|---|
| `js/coros.js` | Koppeling met COROS (OAuth met PKCE, rechtstreeks vanuit de browser) |
| `js/parse.js`, `js/sync.js` | COROS-antwoorden inlezen en lokaal bewaren |
| `js/store.js`, `js/fb.js` | Opslag in de browser en spiegeling naar Firestore |
| `js/stats.js`, `js/physio.js`, `js/norms.js`, `js/food.js`, `js/insights.js` | Berekeningen, normen en duiding |
| `js/plan.js` | Het trainingsschema |
| `js/views.js`, `js/charts.js` | De schermen en de grafieken |

## Firebase

1. Authentication: zet **Email/Password** aan en voeg je GitHub Pages-domein toe bij *Settings → Authorized domains*.
2. Firestore: publiceer de regels uit [`firestore.rules`](firestore.rules).
3. Plak de webconfiguratie in [`js/firebase-config.js`](js/firebase-config.js). Die waarden zijn niet geheim; de beveiliging zit in de regels.

## Tests

```bash
node tests/reken.mjs
```
