"""Universes for the "20 per market" study.

To avoid selecting today's winners, each list consists of the ~20 largest by market cap at the END OF 2015
(fixed past date), including those that subsequently collapsed (GE, Exxon, AT&T, Intel, Telefónica, Vodafone, SoftBank...).
There is no free source of historical index constituents, so the list was established using public market cap data
from that date. Remaining bias (disclosed in panel): companies that delisted since 2015 (mergers, delistings)
have no data on Yahoo and are excluded; in crypto, those Binance delisted.
Crypto: 20 largest as of 2021-01-01 excluding stablecoins, among those trading on Binance then.
"""
from __future__ import annotations

MARKETS = {
    "us": {"label": "US", "index": "^GSPC", "sectors": "us", "tickers": {
        "AAPL": ("Apple", "tech"), "GOOGL": ("Alphabet", "comm"), "MSFT": ("Microsoft", "tech"), "BRK-B": ("Berkshire Hathaway", "fin"),
        "XOM": ("Exxon Mobil", "energy"), "AMZN": ("Amazon", "disc"), "META": ("Meta (Facebook)", "comm"), "GE": ("General Electric", "ind"),
        "JNJ": ("Johnson & Johnson", "health"), "WFC": ("Wells Fargo", "fin"), "JPM": ("JPMorgan", "fin"), "T": ("AT&T", "comm"),
        "PG": ("Procter & Gamble", "staples"), "WMT": ("Walmart", "staples"), "VZ": ("Verizon", "comm"), "PFE": ("Pfizer", "health"),
        "KO": ("Coca-Cola", "staples"), "CVX": ("Chevron", "energy"), "ORCL": ("Oracle", "tech"), "INTC": ("Intel", "tech")}},
    "eu": {"label": "Europe (incl. Spain)", "index": "^STOXX", "sectors": "global", "tickers": {
        "NESN.SW": ("Nestlé", "staples"), "NOVN.SW": ("Novartis", "health"), "RO.SW": ("Roche", "health"), "HSBA.L": ("HSBC", "fin"),
        "SHEL.L": ("Shell", "energy"), "NOVO-B.CO": ("Novo Nordisk", "health"), "SAN.MC": ("Banco Santander", "fin"), "TTE.PA": ("TotalEnergies", "energy"),
        "SAP.DE": ("SAP", "tech"), "SIE.DE": ("Siemens", "ind"), "BAYN.DE": ("Bayer", "health"), "ITX.MC": ("Inditex", "disc"),
        "ABI.BR": ("AB InBev", "staples"), "SAN.PA": ("Sanofi", "health"), "ULVR.L": ("Unilever", "staples"), "GSK.L": ("GSK", "health"),
        "BP.L": ("BP", "energy"), "VOD.L": ("Vodafone", "comm"), "TEF.MC": ("Telefónica", "comm"), "BBVA.MC": ("BBVA", "fin")}},
    "asia": {"label": "Developed Asia", "index": None, "sectors": "global", "tickers": {
        "7203.T": ("Toyota", "disc"), "2330.TW": ("TSMC", "tech"), "005930.KS": ("Samsung Electronics", "tech"), "0700.HK": ("Tencent", "comm"),
        "0941.HK": ("China Mobile", "comm"), "1299.HK": ("AIA", "fin"), "9984.T": ("SoftBank Group", "comm"), "8306.T": ("Mitsubishi UFJ", "fin"),
        "9432.T": ("NTT", "comm"), "6758.T": ("Sony", "disc"), "6861.T": ("Keyence", "tech"), "4502.T": ("Takeda", "health"),
        "7267.T": ("Honda", "disc"), "9433.T": ("KDDI", "comm"), "BHP.AX": ("BHP", "mat"), "CBA.AX": ("Commonwealth Bank", "fin"),
        "WBC.AX": ("Westpac", "fin"), "CSL.AX": ("CSL", "health"), "D05.SI": ("DBS", "fin"), "0388.HK": ("HKEX", "fin")}},
    "crypto": {"label": "Crypto", "index": "BTCUSDT", "sectors": None, "tickers": {
        "BTCUSDT": ("Bitcoin", "crypto"), "ETHUSDT": ("Ethereum", "crypto"), "XRPUSDT": ("XRP", "crypto"), "LTCUSDT": ("Litecoin", "crypto"),
        "BCHUSDT": ("Bitcoin Cash", "crypto"), "LINKUSDT": ("Chainlink", "crypto"), "DOTUSDT": ("Polkadot", "crypto"), "ADAUSDT": ("Cardano", "crypto"),
        "BNBUSDT": ("BNB", "crypto"), "XLMUSDT": ("Stellar", "crypto"), "EOSUSDT": ("EOS", "crypto"), "TRXUSDT": ("Tron", "crypto"),
        "XTZUSDT": ("Tezos", "crypto"), "THETAUSDT": ("Theta", "crypto"), "VETUSDT": ("VeChain", "crypto"), "NEOUSDT": ("NEO", "crypto"),
        "ATOMUSDT": ("Cosmos", "crypto"), "UNIUSDT": ("Uniswap", "crypto"), "DOGEUSDT": ("Dogecoin", "crypto"), "FILUSDT": ("Filecoin", "crypto")}},
}

# local index for each Asian exchange (region has no common free index)
LOCAL_INDEX = {".T": "^N225", ".TW": "^TWII", ".KS": "^KS11", ".HK": "^HSI", ".AX": "^AXJO", ".SI": "^STI"}
# sectors: SPDR for US; iShares Global for Europe/Asia (trade in US: previous day is also used)
SECTOR_ETF = {"us": {"tech": "XLK", "comm": "XLC", "fin": "XLF", "energy": "XLE", "disc": "XLY", "ind": "XLI", "health": "XLV",
                     "staples": "XLP", "mat": "XLB"},
              "global": {"tech": "IXN", "comm": "IXP", "fin": "IXG", "energy": "IXC", "disc": "RXI", "ind": "EXI", "health": "IXJ",
                         "staples": "KXI", "mat": "MXI"}}


def index_for(market: str, sym: str) -> str:
    if market == "asia":
        return next(v for k, v in LOCAL_INDEX.items() if sym.endswith(k))
    return MARKETS[market]["index"]


def all_symbols() -> list[tuple[str, str]]:
    return [(m, s) for m, d in MARKETS.items() for s in d["tickers"]]
