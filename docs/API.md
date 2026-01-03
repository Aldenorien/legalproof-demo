
# LegalProof – Spécification API (sandbox)

Backend : NestJS  
Base URL dev : `http://localhost:3000`  
Format : JSON (sauf endpoints mock FranceConnect qui renvoient de l’HTML)  
Auth : aucune (sandbox / Hackathon)

Endpoints décrits :

1. `POST /onboarding/init`
2. `GET /onboarding/mock-fc`
3. `GET /onboarding/mock-fc/callback`
4. `GET /proof/status`

---

## 1. POST /onboarding/init

Crée une **session d’onboarding** pour un utilisateur identifié par sa **clé publique de wallet Casper**.

### Requête

```http
POST /onboarding/init
Content-Type: application/json

Body JSON :

{
  "wallet_pubkey": "01abc...def",
  "redirect_url": "http://localhost:5173/callback"
}

    wallet_pubkey (string, obligatoire)
    Clé publique Casper hex (ex. 01e4ef7c...673a).

    redirect_url (string, optionnel)
    URL de callback côté frontend (stockée avec la session, usage futur).

Réponse 201

{
  "sessionId": "52",
  "walletPubkey": "01e4ef7cf2355fc45a697d6169f5e17212bc9b0992d18ba8ea1ef4afe04842673a",
  "fcUrl": "http://localhost:3000/onboarding/mock-fc?sessionId=52"
}

    sessionId : identifiant de session (string numérique).

    walletPubkey : rappel de la clé fournie.

    fcUrl : URL de la page de saisie de date de naissance (mock FranceConnect).

Effets de bord

Insertion dans la table sessions :

    id = sessionId

    wallet_pubkey = valeur fournie

    status = INIT

    timestamps created_at / updated_at.

Erreurs possibles

    400 Bad Request

        wallet_pubkey manquant ou vide.

    500 Internal Server Error

        erreur interne (DB, logique…).

2. GET /onboarding/mock-fc

Affiche une page HTML mock FranceConnect permettant à l’utilisateur de saisir sa date de naissance.
Requête

GET /onboarding/mock-fc?sessionId=<ID>

    sessionId (query, obligatoire) : identifiant retourné par /onboarding/init.

Réponses

    200 OK + HTML
    Formulaire simple avec champs day, month, year et bouton de validation.
    Le formulaire soumet vers /onboarding/mock-fc/callback.

    400 Bad Request
    SessionId manquant ou invalide.

    404 Not Found
    Session inexistante.

3. GET /onboarding/mock-fc/callback

Endpoint appelé par le formulaire HTML de mock-fc.
Rôle : récupérer la date de naissance, calculer l’âge, créer éventuellement la preuve.
Requête

GET /onboarding/mock-fc/callback?sessionId=<ID>&day=<DD>&month=<MM>&year=<YYYY>

Params :

    sessionId (obligatoire) : id de session.

    day (obligatoire) : jour (1–31).

    month (obligatoire) : mois (1–12).

    year (obligatoire) : année (ex. 1990).

Logique métier

    Récupérer la session (sessions.id = sessionId), extraire wallet_pubkey.

    Construire un objet date : { day, month, year }.

    Appeler AgeProofService.createAge18PlusClaimIfMajor(wallet_pubkey, birthDate, validityYears=2, sessionId) :

        computeAge → { age, isMajor }.

        buildAge18PlusClaimParams → Age18PlusClaimParams (user_hash, valid_from, valid_until, etc.).

        Si isMajor est vrai :

            appel à casper-client pour register_or_update_claim,

            enregistrement dans age_proofs avec is_major = true et deploy_hash non nul.

        Si isMajor est faux :

            enregistrement dans age_proofs avec is_major = false et deploy_hash = null.

    Retourner une page HTML indiquant l’âge et le statut “majeur / mineur”.

Réponses

    200 OK + HTML (succès).

    400 Bad Request si paramètres manquants / invalides.

    404 Not Found si session introuvable.

    500 Internal Server Error si erreur Casper-client ou DB.

4. GET /proof/status

Endpoint destiné aux sites partenaires pour connaître le statut de la preuve d’âge AGE_18_PLUS d’un wallet.
Requête

GET /proof/status?wallet_pubkey=<HEX>
Accept: application/json

Paramètres :

    wallet_pubkey (query, obligatoire) : clé publique Casper (hex).

Logique métier

    Recherche dans age_proofs :

        wallet_pubkey = <wallet_pubkey>

        claim_type = 'AGE_18_PLUS'

        trié par created_at DESC

        on prend le dernier enregistrement proof.

    Si aucun enregistrement :

        has_proof = false, is_major = false, tout le reste à null.

    Sinon, calcul de la validité courante :

        valid_from_ts = proof.valid_from (timestamp Unix sec, à partir de la colonne timestamp with time zone).

        valid_until_ts = proof.valid_until.

        now = Date.now() / 1000.

    Une preuve est considérée actuellement valide si :

        proof.is_major === true

        proof.revoked === false

        valid_from_ts != null

        valid_until_ts != null

        valid_from_ts <= now <= valid_until_ts

    Construction de la réponse JSON.

Réponse 200

Exemple (preuve valide) :

{
  "wallet_pubkey": "01e4ef7cf2355fc45a697d6169f5e17212bc9b0992d18ba8ea1ef4afe04842673a",
  "has_proof": true,
  "is_major": true,
  "revoked": false,
  "valid_from": 1767231634,
  "valid_until": 1830303634,
  "deploy_hash": "0fee39a64e7b9162bc6df1c160c8e5a6ffe5be59a6fb4a1250d95ffa4743f227"
}

Exemple (aucune preuve) :

{
  "wallet_pubkey": "01....",
  "has_proof": false,
  "is_major": false,
  "revoked": false,
  "valid_from": null,
  "valid_until": null,
  "deploy_hash": null
}

Champs

    wallet_pubkey (string)
    Clé publique demandée.

    has_proof (boolean)

        false si aucun enregistrement age_proofs trouvé.

        true sinon.

    is_major (boolean)

        true si la dernière preuve est majeure et actuellement valide.

        false sinon (mineur, expiré, révoqué…).

    revoked (boolean)
    Indique si la dernière preuve est marquée comme révoquée en base.

    valid_from / valid_until (number | null)
    Timestamps Unix (secondes) de début / fin de validité.

    deploy_hash (string | null)
    Hash du deploy Casper associé (ou null si aucun deploy, ex. mineur).

Erreurs

    400 Bad Request

        wallet_pubkey manquant ou vide.

    500 Internal Server Error

        erreur DB ou logique interne.

5. Notes d’usage pour intégrateurs
Décision d’accès simple

Pseudo-code côté site partenaire (Web2 / Web3) :

const res = await fetch(
  `https://legalproof.example.com/proof/status?wallet_pubkey=${walletPubkey}`,
);
const data = await res.json();

if (data.is_major === true) {
  // Accès autorisé
} else {
  // Accès refusé : inviter l’utilisateur à créer ou renouveler sa preuve
}

    Utiliser is_major pour la décision binaire “autorisé / refusé”.

    Utiliser valid_until pour afficher une date d’expiration (“preuve valable jusqu’au …”).

    Utiliser has_proof pour distinguer “jamais créé de preuve” vs “preuve expirée/révoquée”.

Cette spécification est celle utilisée dans le prototype actuel (sandbox / Hackathon).

::contentReference[oaicite:0]{index=0}

