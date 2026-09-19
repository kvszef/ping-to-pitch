-- Schema für data/unrisk.db. Gefüllt von scripts/load-data.ts aus
--   ../core-case/portfolio-data/clients.json
--   ../core-case/portfolio-data/reference.json
--   data/callers.json
--
-- Zwei Regeln, die überall gelten:
--  1. Jede Tabelle führt raw_json mit dem unveränderten Quellobjekt. MCP Toolbox parst
--     JSON-Strings in Ergebniszellen automatisch, das Modell bekommt also verschachteltes
--     JSON statt Fliesstext. Neue Fragen brauchen dann kein neues Schema.
--     Zwei Ausnahmen, damit eine einzige Zelle nicht die halbe Quelldatei enthält und
--     ein `SELECT *` den Modellkontext sprengt: clients.raw_json lässt Portfolios,
--     Proposals, Transactions, SuitabilityViolations und ClientNotes weg,
--     portfolios.raw_json lässt SecurityPositions und AccountPositions weg. Genau diese
--     Sammlungen haben eigene Tabellen, es geht also nichts verloren. Alles ohne eigene
--     Tabelle bleibt drin: Tags und IndividualRuleOverrides beim Kunden,
--     PerformanceHistory beim Portfolio, die Positionen beim Anlagevorschlag.
--  2. Konventionen aus core-case/portfolio-data/DATA.md: Join über SecurityId statt Isin,
--     SAA_*-Felder für Soll-Ist-Vergleiche, Prozente sind Brüche von 0 bis 1
--     (Ausnahme FundUnbundlingMappings[].Weight: 0 bis 100), fehlende Felder sind
--     abwesend statt null, Konto-Currency kann ein Ticker wie BTC oder ETH sein.
--
-- Beim Laden der echten Daten ergänzte Spalten (nichts umbenannt, nichts entfernt):
--   clients.is_employee, .esg_profile_id, .tags        -- IsEmployee wird im Gespräch
--       gebraucht (Mitarbeitergeschäft), tags ist die Interessenliste flach als Text,
--       weil Client.Tags[] keine eigene Tabelle hat.
--   portfolios.strategy_id, .service_id, .reference_ccy, .nav_latest, .nav_date,
--       .performance_12m                               -- PerformanceYTD steht in DATA.md,
--       fehlt aber in allen 57 Portfolios der Lieferung. Der Lader rechnet ytd und 12m
--       deshalb aus PerformanceHistory. Das ist eine Wertveränderung und keine Rendite,
--       siehe die Warnung an der Spalte. Ist PerformanceYTD in einer späteren Datei doch
--       gesetzt, gewinnt der gelieferte Wert.
--   positions.security_type, .saa_currency_group, .saa_country_group, .saa_industry,
--       .contribution_volatility                       -- saa_targets kennt vier
--       Dimensionen, nicht nur AssetClass; ohne die drei Geschwisterfelder ist ein
--       Soll-Ist nach Währung, Region oder Branche ohne Join auf securities nicht möglich.
--       ContributionVolatility ist der Beitrag, der sich zu portfolios.volatility summiert.
--   accounts.is_crypto                                 -- siehe Kommentar an der Tabelle.
--   proposals.currency, .saa_id, .position_count
--   transactions.transaction_id, .proposal_id, .security_id, .isin, .quantity, .amount,
--       .currency, .forward_state                      -- ohne Betrag und Währung lässt
--       sich zu einer Order nichts sagen.
--   violations.error_level
--   securities.security_type, .saa_currency_group, .saa_country_group, .saa_industry,
--       .country, .industry, .volatility, .expected_return, .price, .ytm, .maturity_date
--   risk_profiles.risk_level

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
  is_employee       INTEGER NOT NULL DEFAULT 0,-- IsEmployee, Bankmitarbeiter
  client_type       TEXT,                      -- RegulatoryClientTypeName
  reporting_ccy     TEXT,                      -- ReportingCurrency
  risk_profile_id   INTEGER,                   -- bei 4 Kunden gar nicht gesetzt: LEFT JOIN
                                               -- auf risk_profiles nutzen, sonst fallen sie weg
  risk_profile      TEXT,                      -- RiskProfileName
  esg_profile_id    INTEGER,
  esg_profile       TEXT,                      -- EsgProfileName, bei 19 Kunden leer
  tags              TEXT,                      -- Interessen, z. B. "Switzerland (Region), Health Care (Industry)"
  birthday          TEXT,
  profiling_date    TEXT,                      -- ProfilingDateUtc
  aum               REAL,                      -- AssetsUnderManagementInDefaultCurrency
  liquidity         REAL,                      -- LiquidityInDefaultCurrency
  -- Freitext zum Kunden. Startwert aus dem Feld `Description` der Quelldatei, danach haengt
  -- der Copilot nach jedem Gespraech eine kurze Zusammenfassung an. scripts/load-data.ts
  -- rettet diese Ergaenzungen ueber einen Neuaufbau der Stammdaten hinweg -- sonst waere das
  -- Gespraechsgedaechtnis nach jedem `npm run load-data` weg.
  description       TEXT,
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
  reference_ccy     TEXT,                      -- ReferenceCurrency der SAA, kann abweichen
  saa_id            INTEGER,                   -- StrategicAssetAllocationId -> saa_targets.saa_id
  service_id        INTEGER,                   -- InvestmentServiceId
  service_name      TEXT,                      -- InvestmentServiceName
  strategy_id       INTEGER,                   -- StrategyId
  strategy_name     TEXT,                      -- StrategyName
  aum               REAL,                      -- in der Berichtswährung des Kunden, nicht in currency
  liquidity         REAL,
  volatility        REAL,
  expected_return   REAL,
  value_at_risk     REAL,
  -- ACHTUNG, keine Rendite: Wertveränderung des Portfolios aus PerformanceHistory, und die
  -- enthält Ein- und Auszahlungen. Alle acht reinen Cash-Portfolios zeigen so bis zu +16 %,
  -- das sind Einzahlungen auf ein Vorsorgekonto, kein Ertrag. Am Telefon also als
  -- "Vermögen gewachsen von ... auf ..." verwenden, nie als "Rendite von x %".
  performance_ytd   REAL,                      -- seit dem letzten Stand vor dem 1. Januar
  performance_12m   REAL,                      -- gegen den Stand 12 Monate davor
  nav_latest        REAL,                      -- jüngster Wert aus PerformanceHistory
  nav_date          TEXT,                      -- dessen Datum
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
  contribution_volatility REAL,                -- summiert sich über das Portfolio zu portfolios.volatility
  -- Die nächsten fünf sind beim Laden aus securities kopiert, damit ein Soll-Ist ohne Join geht.
  security_type     TEXT,                      -- SecurityTypeName
  asset_class       TEXT,                      -- AssetClassName, feine Taxonomie
  saa_asset_class   TEXT,                      -- SAA_AssetClassName, passt zu saa_targets
  saa_currency_group TEXT,                     -- SAA_CurrencyGroupName
  saa_country_group TEXT,                      -- SAA_CountryGroupName
  saa_industry      TEXT,                      -- SAA_IndustryName
  raw_json          TEXT NOT NULL
);

-- Kontopositionen sind eigene Zeilen: Currency kann ein Ticker wie BTC sein und hat kein SecurityId.
-- Für Soll-Ist nach Anlageklasse zählen Konten als "Liquidity", sie haben kein SAA_AssetClassName.
CREATE TABLE accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  portfolio_id      INTEGER NOT NULL REFERENCES portfolios(portfolio_id),
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  account_name      TEXT,
  currency          TEXT,
  amount            REAL,                      -- TotalAmountInPortfolioCurrency, immer echtes Geld
  weight            REAL,
  -- 1, wenn currency ein Kryptoticker aus einer festen Liste ist (BTC, ETH, SOL, DOT, SHIB, ...).
  -- Bewusst eine Liste und keine Regel: OZG ist eine Unze Gold und damit kein Krypto, und ein
  -- unbekannter Ticker aus einer späteren Datei soll lieber als 0 auffallen als falsch als 1.
  is_crypto         INTEGER NOT NULL DEFAULT 0,
  raw_json          TEXT NOT NULL
);

-- ---------------------------------------------------------------- Beratung

CREATE TABLE proposals (
  proposal_id       INTEGER PRIMARY KEY,
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  portfolio_id      INTEGER,                   -- ein Vorschlag zeigt auf ein Portfolio, das
                                               -- nicht mehr geliefert wird: kein FK, LEFT JOIN
  status            TEXT,                      -- ProposalStatusName
  advisory_type     TEXT,                      -- AdvisoryTypeName
  currency          TEXT,
  saa_id            INTEGER,                   -- StrategicAssetAllocationId
  position_count    INTEGER,                   -- Anzahl SecurityPositions im Vorschlag
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
  portfolio_id      INTEGER,                   -- nicht in der Quelle, über ProposalId nachgeschlagen
  transaction_id    INTEGER,                   -- TransactionId aus der Quelle
  proposal_id       INTEGER,                   -- ProposalId, jede Order hängt an einem Vorschlag
  security_id       INTEGER,                   -- fehlt bei reinen Bargeldbuchungen
  isin              TEXT,
  security_name     TEXT,
  quantity          REAL,                      -- QuantityForTransaction
  amount            REAL,                      -- TotalAmount, in currency
  currency          TEXT,
  is_expiry         INTEGER,                   -- 1 = Verfall, nie zur Order freigebbar
  forward_state     INTEGER,                   -- 0 = in Ordnung, 2 = Warnung, NULL kommt vor
  raw_json          TEXT NOT NULL
);

CREATE TABLE violations (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  client_ref        TEXT NOT NULL REFERENCES clients(client_ref),
  portfolio_id      INTEGER,
  rule_code         TEXT,
  rule_description  TEXT,
  severity          TEXT,                      -- "Error" oder "Warning", bei Ausnahmen leer
  error_level       INTEGER,                   -- 1 = Warnung, alles andere Fehler
  security_isin     TEXT,                      -- leer, wenn der Verstoss an keinem Titel hängt
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
  security_type     TEXT,                      -- SecurityTypeName, z. B. Shares, Investment fund
  asset_class       TEXT,                      -- AssetClassName, feine Taxonomie
  saa_asset_class   TEXT,                      -- SAA_AssetClassName, passt zu saa_targets
  saa_currency_group TEXT,                     -- SAA_CurrencyGroupName, Dimension CurrencyGroup
  saa_country_group TEXT,                      -- SAA_CountryGroupName, Dimension CountryGroup
  saa_industry      TEXT,                      -- SAA_IndustryName, Dimension Industry
  country           TEXT,                      -- CountryName, feiner als saa_country_group
  industry          TEXT,                      -- IndustryName, feiner als saa_industry
  currency          TEXT,
  price             REAL,                      -- EndOfDayPrice, in currency
  volatility        REAL,
  expected_return   REAL,
  ytm               REAL,                      -- YieldToMaturity
  maturity_date     TEXT,                      -- Jahr 2299 heisst "ewig", kein Datenfehler
  sustainability    REAL,                      -- SustainabilityScore
  prc               REAL,
  in_recommendation INTEGER,
  raw_json          TEXT NOT NULL
);

-- Zielallokation je Strategie, eine Zeile je Dimension und Kategorie.
-- Ohne raw_json, als einzige Tabelle neben phone_map: ein Mappings[]-Eintrag besteht genau
-- aus den fünf Spalten unten, das Rohobjekt wäre reine Verdoppelung. phone_map ist die
-- gemockte Zuordnung und hat gar kein Quellobjekt.
CREATE TABLE saa_targets (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  saa_id            INTEGER NOT NULL,
  saa_name          TEXT,
  dimension         TEXT,                      -- AssetClass, CurrencyGroup, CountryGroup, Industry
  category          TEXT,                      -- z. B. Shares, Swiss francs, North America, Energy;
                                               -- passt zu securities.saa_* der gleichen Dimension
  -- Bruch 0..1. Bandbreiten gibt es nur für die Dimension AssetClass; bei CurrencyGroup,
  -- CountryGroup und Industry sind min_pct und max_pct durchgängig leer, dort steht nur ein
  -- Zielwert. Vier Strategien ohne Anlageprofil ("Keine Strategie", "Execution only",
  -- "Standard Portfolio", "Vorsorgeprodukte") führen target_pct 0 bei max_pct 1, das ist
  -- keine Vorgabe, sondern deren Fehlen -- nicht als "Ziel 0 %" vorlesen.
  min_pct           REAL,
  target_pct        REAL,
  max_pct           REAL
);

CREATE TABLE risk_profiles (
  id                INTEGER PRIMARY KEY,
  name              TEXT,
  risk_level        INTEGER,                   -- RiskLevel, 3 bis 7
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
CREATE INDEX ix_transactions_client ON transactions(client_ref);
CREATE INDEX ix_securities_isin    ON securities(isin);
CREATE INDEX ix_violations_client  ON violations(client_ref, severity);
CREATE INDEX ix_notes_client       ON notes(client_ref, created_at DESC);
CREATE INDEX ix_saa_targets        ON saa_targets(saa_id, dimension);
CREATE INDEX ix_clients_name       ON clients(name COLLATE NOCASE);
CREATE INDEX ix_phone_map_client   ON phone_map(client_ref);
