-- Schema für data/unrisk.db. Gefüllt von scripts/load-data.ts aus
--   ../core-case/portfolio-data/clients.json
--   ../core-case/portfolio-data/reference.json
--   data/callers.json
--
-- Zwei Regeln, die überall gelten:
--  1. Jede Tabelle führt raw_json mit dem unveränderten Quellobjekt. MCP Toolbox parst
--     JSON-Strings in Ergebniszellen automatisch, das Modell bekommt also verschachteltes
--     JSON statt Fliesstext. Neue Fragen brauchen dann kein neues Schema.
--  2. Konventionen aus core-case/portfolio-data/DATA.md: Join über SecurityId statt Isin,
--     SAA_*-Felder für Soll-Ist-Vergleiche, Prozente sind Brüche von 0 bis 1
--     (Ausnahme FundUnbundlingMappings[].Weight: 0 bis 100), fehlende Felder sind
--     abwesend statt null, Konto-Currency kann ein Ticker wie BTC oder ETH sein.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS phone_map;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS violations;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS proposals;
DROP TABLE IF EXISTS positions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS portfolios;
DROP TABLE IF EXISTS clients;
DROP TABLE IF EXISTS securities;
DROP TABLE IF EXISTS saa_targets;
DROP TABLE IF EXISTS risk_profiles;

-- ---------------------------------------------------------------- Kundenstamm

CREATE TABLE clients (
  client_ref        TEXT PRIMARY KEY,          -- ClientRef, z. B. CASE-001
  client_id         INTEGER,                   -- ClientId
  name              TEXT NOT NULL,             -- Firma oder "Vorname Nachname"
  first_name        TEXT,
  last_name         TEXT,
  company           TEXT,
  is_company        INTEGER NOT NULL DEFAULT 0,
  client_type       TEXT,                      -- RegulatoryClientTypeName
  reporting_ccy     TEXT,                      -- ReportingCurrency
  risk_profile_id   INTEGER,
  risk_profile      TEXT,                      -- RiskProfileName
  esg_profile       TEXT,                      -- EsgProfileName
  birthday          TEXT,
  profiling_date    TEXT,                      -- ProfilingDateUtc
  aum               REAL,                      -- AssetsUnderManagementInDefaultCurrency
  liquidity         REAL,                      -- LiquidityInDefaultCurrency
  raw_json          TEXT NOT NULL
);

-- Anrufernummer -> Kunde. Die Case-Daten enthalten keine Telefonnummern, diese Tabelle
-- ist deshalb der einzige bewusst gemockte Teil der Datenkette (Quelle: data/callers.json).
CREATE TABLE phone_map (
  phone_e164  TEXT PRIMARY KEY,                -- +41791234567
  client_ref  TEXT NOT NULL REFERENCES clients(client_ref),
  label       TEXT,                            -- mobil, geschaeft, partner ...
  updated_at  TEXT
);

-- ---------------------------------------------------------------- Portfolios

CREATE TABLE portfolios (
  portfolio_id      INTEGER PRIMARY KEY,       -- PortfolioId
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  portfolio_nr      TEXT,                      -- PortfolioNr
  name              TEXT,
  currency          TEXT,                      -- PortfolioCurrency
  saa_id            INTEGER,                   -- StrategicAssetAllocationId
  service_name      TEXT,                      -- InvestmentServiceName
  strategy_name     TEXT,                      -- StrategyName
  aum               REAL,
  liquidity         REAL,
  volatility        REAL,
  expected_return   REAL,
  value_at_risk     REAL,
  performance_ytd   REAL,
  factory_date      TEXT,                      -- FactoryDateUtc
  raw_json          TEXT NOT NULL
);

CREATE TABLE positions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id      INTEGER NOT NULL REFERENCES portfolios(portfolio_id),
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  security_id       INTEGER,                   -- SecurityId, Join-Schluessel (nicht Isin)
  isin              TEXT,
  security_name     TEXT,
  quantity          REAL,
  price_per_unit    REAL,
  currency          TEXT,
  amount            REAL,                      -- TotalAmountInPortfolioCurrency
  weight            REAL,                      -- PortfolioValuePercentage, Bruch 0..1
  asset_class       TEXT,                      -- aus securities.asset_class
  saa_asset_class   TEXT,                      -- SAA_AssetClassName, fuer Soll-Ist
  raw_json          TEXT NOT NULL
);

-- Kontopositionen sind eigene Zeilen: Currency kann ein Ticker wie BTC sein und hat kein SecurityId.
CREATE TABLE accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id      INTEGER NOT NULL REFERENCES portfolios(portfolio_id),
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  account_name      TEXT,
  currency          TEXT,
  amount            REAL,
  weight            REAL,
  raw_json          TEXT NOT NULL
);

-- ---------------------------------------------------------------- Beratung

CREATE TABLE proposals (
  proposal_id       INTEGER PRIMARY KEY,
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  portfolio_id      INTEGER,
  status            TEXT,                      -- ProposalStatusName
  advisory_type     TEXT,                      -- AdvisoryTypeName
  proposed_at       TEXT,                      -- ProposedDateUTC
  finalized_at      TEXT,
  submitted_at      TEXT,
  reason            TEXT,
  notes             TEXT,
  expected_return   REAL,
  volatility        REAL,
  value_at_risk     REAL,
  raw_json          TEXT NOT NULL
);

CREATE TABLE transactions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  portfolio_id      INTEGER,
  security_name     TEXT,
  is_expiry         INTEGER,
  raw_json          TEXT NOT NULL
);

CREATE TABLE violations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  portfolio_id      INTEGER,
  rule_code         TEXT,
  rule_description  TEXT,
  severity          TEXT,
  security_isin     TEXT,
  last_violated_at  TEXT,                      -- LastViolatedDateUTC
  is_override       INTEGER NOT NULL DEFAULT 0,-- aus IndividualRuleOverrides
  raw_json          TEXT NOT NULL
);

CREATE TABLE notes (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  created_at        TEXT,                      -- CreatedByDateUTC
  text              TEXT,
  raw_json          TEXT NOT NULL
);

-- ---------------------------------------------------------------- Stammdaten

CREATE TABLE securities (
  security_id       INTEGER PRIMARY KEY,       -- Id in reference.Securities
  isin              TEXT,                      -- nicht eindeutig: eine ISIN je Waehrungstranche
  name              TEXT,
  asset_class       TEXT,                      -- AssetClassName, feine Taxonomie
  saa_asset_class   TEXT,                      -- SAA_AssetClassName, passt zu saa_targets
  currency          TEXT,
  sustainability    REAL,                      -- SustainabilityScore
  prc               REAL,
  in_recommendation INTEGER,
  raw_json          TEXT NOT NULL
);

-- Zielallokation je Strategie, eine Zeile je Dimension und Kategorie.
CREATE TABLE saa_targets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  saa_id            INTEGER NOT NULL,
  saa_name          TEXT,
  dimension         TEXT,                      -- z. B. AssetClass, Currency
  category          TEXT,                      -- z. B. Shares, Bonds
  min_pct           REAL,                      -- Bruch 0..1
  target_pct        REAL,
  max_pct           REAL
);

CREATE TABLE risk_profiles (
  id                INTEGER PRIMARY KEY,
  name              TEXT,
  max_vola          REAL,
  max_prc           REAL,
  equity_quote_pct  REAL,
  raw_json          TEXT NOT NULL
);

-- ---------------------------------------------------------------- Indizes

CREATE INDEX ix_positions_client   ON positions(client_ref, amount DESC);
CREATE INDEX ix_positions_pf       ON positions(portfolio_id);
CREATE INDEX ix_accounts_client    ON accounts(client_ref);
CREATE INDEX ix_portfolios_client  ON portfolios(client_ref);
CREATE INDEX ix_proposals_client   ON proposals(client_ref, proposed_at DESC);
CREATE INDEX ix_violations_client  ON violations(client_ref, severity);
CREATE INDEX ix_notes_client       ON notes(client_ref, created_at DESC);
CREATE INDEX ix_saa_targets        ON saa_targets(saa_id, dimension);
CREATE INDEX ix_clients_name       ON clients(name COLLATE NOCASE);
CREATE INDEX ix_phone_map_client   ON phone_map(client_ref);
