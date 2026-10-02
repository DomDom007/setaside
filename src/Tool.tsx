// Setaside: tells a freelancer how much of each payment to move into a tax pot, and what is due each quarter.
import { useState } from "react";
import { downloadIcs, localDate } from "./lib/ics";
import { moneyFmt } from "./lib/money";
import { uid, useStored } from "./lib/store";
import { todayISO } from "./lib/time";
import { CurrencySelect, Section, Stat, Stats } from "./ui/kit";

const T = "setaside";
type Pay = { id: string; date: string; client: string; amount: number; moved: boolean };
type Bracket = { upTo: number; rate: number };
type Settings = { currency: string; social: number; vat: number; expensesPct: number; brackets: Bracket[]; allowance: number; dueDates: string[] };
const DEFAULTS: Settings = {
  currency: "TND", social: 14.71, vat: 0, expensesPct: 10, allowance: 0,
  brackets: [{ upTo: 5000, rate: 0 }, { upTo: 20000, rate: 26 }, { upTo: 30000, rate: 28 }, { upTo: 50000, rate: 32 }, { upTo: 1e12, rate: 35 }],
  dueDates: ["04-28", "07-28", "10-28", "01-28"],
};
const y = new Date().getFullYear();
const SAMPLE: Pay[] = [
  { id: "p1", date: `${y}-01-18`, client: "Studio Nord", amount: 3200, moved: true }, { id: "p2", date: `${y}-02-25`, client: "Glazeco", amount: 1800, moved: true },
  { id: "p3", date: `${y}-04-10`, client: "Studio Nord", amount: 4100, moved: true }, { id: "p4", date: `${y}-06-02`, client: "Maison Jasmin", amount: 2600, moved: false },
  { id: "p5", date: `${y}-07-19`, client: "Glazeco", amount: 3900, moved: false }, { id: "p6", date: `${y}-09-05`, client: "Studio Nord", amount: 2800, moved: false },
];

/** Income tax on a yearly taxable amount using progressive brackets. */
function incomeTax(taxable: number, brackets: Bracket[]) {
  let tax = 0, prev = 0;
  for (const b of brackets) { const slice = Math.max(0, Math.min(taxable, b.upTo) - prev); tax += (slice * b.rate) / 100; prev = b.upTo; if (taxable <= b.upTo) break; }
  return tax;
}

export default function Setaside() {
  const [pays, setPays] = useStored<Pay[]>(T, "pays", SAMPLE);
  const [s, setS] = useStored<Settings>(T, "settings", DEFAULTS);
  const [d, setD] = useState({ date: todayISO(), client: "", amount: "" });
  const [showRules, setShowRules] = useState(false);
  const money = moneyFmt(s.currency);
  const year = pays.filter(p => p.date.startsWith(String(y)));
  const gross = year.reduce((a, p) => a + p.amount, 0);
  const monthsSoFar = Math.max(1, new Date().getMonth() + 1);
  const projected = (gross / monthsSoFar) * 12;
  // Effective rate from the projected year, so early payments are not under-saved.
  const taxFor = (g: number) => { const soc = (g * s.social) / 100; const taxable = Math.max(0, g * (1 - s.expensesPct / 100) - soc - s.allowance); return { soc, inc: incomeTax(taxable, s.brackets), vat: (g * s.vat) / 100 }; };
  const proj = taxFor(projected);
  const rate = projected ? (proj.soc + proj.inc) / projected + s.vat / 100 : 0;
  const owedSoFar = gross * rate;
  const moved = year.filter(p => p.moved).reduce((a, p) => a + p.amount * rate, 0);
  const behind = owedSoFar - moved;
  const quarters = [0, 1, 2, 3].map(q => { const qp = year.filter(p => Math.floor((+p.date.slice(5, 7) - 1) / 3) === q); const g = qp.reduce((a, p) => a + p.amount, 0); return { q, g, due: `${q === 3 ? y + 1 : y}-${s.dueDates[q]}`, amount: g * rate }; });
  const add = (e: React.FormEvent) => { e.preventDefault(); const a = parseFloat(d.amount) || 0; if (!a) return; setPays([{ id: uid(), date: d.date, client: d.client || "Client", amount: a, moved: false }, ...pays]); setD({ ...d, client: "", amount: "" }); };

  return (
    <div className="stack">
      <Section title={`Tax pot for ${y}`} aside={<CurrencySelect id="sa-cur" value={s.currency} onChange={c => setS({ ...s, currency: c })} />}>
        <Stats><Stat value={`${(rate * 100).toFixed(1)}%`} label="Set aside from every payment" /><Stat value={money(gross)} label="Earned this year" /><Stat value={money(owedSoFar)} label="Should be in the pot" /><Stat value={money(Math.abs(behind))} label={behind > 0.5 ? "Still to move" : "Ahead"} tone={behind > 0.5 ? "bad" : "good"} /></Stats>
        <p className="note" style={{ marginTop: 10 }}>Based on {money(projected)} projected for the full year: social contributions {money(proj.soc)}, income tax {money(proj.inc)}{s.vat ? `, VAT ${money(proj.vat)}` : ""}.</p>
      </Section>

      <div className="grid2">
        <Section title="Got paid?">
          <form className="stack" style={{ gap: 10 }} onSubmit={add}>
            <div className="row"><label className="field"><span>Amount received</span><input id="sa-a" className="input num" inputMode="decimal" value={d.amount} onChange={e => setD({ ...d, amount: e.target.value })} /></label><label className="field"><span>Client</span><input id="sa-c" className="input" value={d.client} onChange={e => setD({ ...d, client: e.target.value })} /></label></div>
            <div className="row" style={{ alignItems: "flex-end" }}><label className="field"><span>Date</span><input id="sa-d" type="date" className="input" value={d.date} onChange={e => setD({ ...d, date: e.target.value })} /></label><button className="btn primary" type="submit">Add payment</button></div>
            {parseFloat(d.amount) > 0 && <p className="sa-hint">Move <strong>{money((parseFloat(d.amount) || 0) * rate)}</strong> to your tax account. Keep {money((parseFloat(d.amount) || 0) * (1 - rate))}.</p>}
          </form>
        </Section>
        <Section title="Quarterly payments" aside={<button className="btn small" onClick={() => downloadIcs("tax-due-dates.ics", quarters.map(q => ({ title: `Tax payment due: about ${money(q.amount)}`, start: localDate(q.due), allDay: true, alarmMinutes: 0 })), "Tax due dates")}>Add to calendar</button>}>
          <table className="t"><tbody>{quarters.map(q => <tr key={q.q}><td>Q{q.q + 1}</td><td className="num">due {q.due}</td><td className="r">{money(q.g)} earned</td><td className="r"><strong>{money(q.amount)}</strong></td></tr>)}</tbody></table>
        </Section>
      </div>

      <Section title="Payments">
        <div className="table-wrap"><table className="t"><thead><tr><th>Date</th><th>Client</th><th className="r">Received</th><th className="r">Set aside</th><th>Moved to pot</th><th /></tr></thead>
          <tbody>{pays.sort((a, b) => b.date.localeCompare(a.date)).map(p => <tr key={p.id}><td className="num">{p.date}</td><td>{p.client}</td><td className="r">{money(p.amount)}</td><td className="r">{money(p.amount * rate)}</td>
            <td><label className="check"><input type="checkbox" checked={p.moved} onChange={e => setPays(pays.map(x => x.id === p.id ? { ...x, moved: e.target.checked } : x))} />{p.moved ? "Done" : "Not yet"}</label></td>
            <td><button className="btn ghost small danger" onClick={() => setPays(pays.filter(x => x.id !== p.id))}>Delete</button></td></tr>)}</tbody></table></div>
      </Section>

      <Section title="Your tax rules" aside={<button className="btn small" onClick={() => setShowRules(!showRules)}>{showRules ? "Hide" : "Edit"}</button>}>
        <p className="note">Defaults follow a common freelance setup. Tax law changes and depends on your situation, so check the rates with an accountant and edit them here.</p>
        {showRules && <div className="stack" style={{ gap: 10, marginTop: 12 }}>
          <div className="row">
            <label className="field"><span>Social contributions %</span><input id="sa-soc" className="input num" value={s.social} onChange={e => setS({ ...s, social: parseFloat(e.target.value) || 0 })} /></label>
            <label className="field"><span>Deductible expenses %</span><input id="sa-exp" className="input num" value={s.expensesPct} onChange={e => setS({ ...s, expensesPct: parseFloat(e.target.value) || 0 })} /></label>
            <label className="field"><span>VAT you collect %</span><input id="sa-vat" className="input num" value={s.vat} onChange={e => setS({ ...s, vat: parseFloat(e.target.value) || 0 })} /></label>
            <label className="field"><span>Yearly allowance</span><input id="sa-all" className="input num" value={s.allowance} onChange={e => setS({ ...s, allowance: parseFloat(e.target.value) || 0 })} /></label>
          </div>
          <p className="eyebrow">Income tax brackets</p>
          {s.brackets.map((b, i) => (
            <div key={i} className="row" style={{ alignItems: "center" }}>
              <span className="note" style={{ width: 90 }}>{i === 0 ? "From 0" : `Above ${s.brackets[i - 1].upTo.toLocaleString()}`}</span>
              <label className="field"><span>Up to</span><input className="input num" value={b.upTo >= 1e12 ? "" : b.upTo} placeholder="No limit" onChange={e => setS({ ...s, brackets: s.brackets.map((x, k) => k === i ? { ...x, upTo: e.target.value ? parseFloat(e.target.value) : 1e12 } : x) })} /></label>
              <label className="field"><span>Rate %</span><input className="input num" value={b.rate} onChange={e => setS({ ...s, brackets: s.brackets.map((x, k) => k === i ? { ...x, rate: parseFloat(e.target.value) || 0 } : x) })} /></label>
            </div>
          ))}
          <label className="field"><span>Quarterly due dates (month-day), separated by commas</span><input id="sa-due" className="input" value={s.dueDates.join(", ")} onChange={e => setS({ ...s, dueDates: e.target.value.split(",").map(x => x.trim()).slice(0, 4) })} /></label>
          <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => setS({ ...DEFAULTS, currency: s.currency })}>Reset to defaults</button>
        </div>}
      </Section>
      <style>{`.sa-hint{font-size:18px;padding:12px;border-radius:8px;background:var(--sunk)}`}</style>
    </div>
  );
}
