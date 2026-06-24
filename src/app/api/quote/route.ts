// src/app/api/quote/route.ts

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code') || '';

  try {
    // 先試上市（tse）
    const r = await fetch(
      `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=tse_${code}.tw&json=1&delay=0`,
      { headers: { 'Referer': 'https://mis.twse.com.tw/' } }
    );
    const j = await r.json();
    const d = j.msgArray?.[0];

    if (d?.z && d.z !== '-') {
      const price = +d.z, prev = +d.y;
      return Response.json({
        price,
        change: +(price - prev).toFixed(2),
        change_pct: +((price - prev) / prev * 100).toFixed(2),
        is_trading: true,
        time: d.t || ''
      });
    }

    // 若無即時價（收盤後），回傳收盤價
    if (d?.z === '-' && d?.y) {
      const price = +d.y;
      return Response.json({
        price,
        change: 0,
        change_pct: 0,
        is_trading: false,
        time: ''
      });
    }
  } catch {}

  return Response.json(null);
}