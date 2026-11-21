'use client';

import { ArrowLeftRight, X } from 'lucide-react';
import { useStorefrontText } from '@packages/components/storefront-language';
import { PC_SLOTS, type PcSlot } from '@packages/utils/pc-build';
import type { PcSelection } from '@packages/utils/pc-build-selection';
import { formatUSD } from '@packages/utils/money';
import { pcProductSpecifications } from './product-card';

type QuotedPart = {
  id: string;
  slot: PcSlot;
  title: string;
  sale_price: number;
  custom_specification?: unknown;
};

export type SavedPcBuild = {
  id: string;
  name: string;
  parts: PcSelection[];
  quote?: {
    parts?: QuotedPart[];
    total?: number;
    updatedAt?: string;
    issues?: { level: string; message: string }[];
  } | null;
  updatedAt: string;
};

const slotLabels: Record<PcSlot, string> = {
  cpu: 'CPU / Processor',
  motherboard: 'Motherboard',
  ram: 'Memory / RAM',
  gpu: 'Graphics card',
  storage: 'Storage',
  psu: 'Power supply',
  case: 'PC case',
  cooler: 'CPU cooler',
};

function slotPart(build: SavedPcBuild, slot: PcSlot): QuotedPart | undefined {
  const selection = build.parts.find(part => part.slot === slot);
  if (!selection) return undefined;
  return build.quote?.parts?.find(part => part.slot === slot && part.id === selection.id);
}

function specifications(part: QuotedPart | undefined) {
  return part ? pcProductSpecifications(part.custom_specification) : [];
}

function savedAt(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

export default function PcBuildComparison({
  a, b, onClose,
}: {
  a: SavedPcBuild;
  b: SavedPcBuild;
  onClose: () => void;
}) {
  const { t } = useStorefrontText();
  const totalA = typeof a.quote?.total === 'number' ? a.quote.total : null;
  const totalB = typeof b.quote?.total === 'number' ? b.quote.total : null;
  const difference = totalA === null || totalB === null ? null : totalA - totalB;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-6" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="pc-build-comparison-title" className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600"><ArrowLeftRight size={20} aria-hidden="true" /></span>
          <div>
            <h2 id="pc-build-comparison-title" className="text-lg font-bold text-slate-900">{t('Compare complete builds')}</h2>
            <p className="mt-1 text-xs text-slate-500">{t('Compare overall price, every component and compatibility notes.')}</p>
          </div>
        </div>
        <button type="button" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-2 focus-visible:outline-blue-500" aria-label={t('Close comparison')} onClick={onClose}><X size={18} /></button>
      </header>

      <div className="overflow-auto p-5 sm:p-7">
        <div className="mb-5 grid gap-3 sm:grid-cols-2">
          {[a, b].map((build, index) => <div key={build.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t(index === 0 ? 'Build A' : 'Build B')}</p>
            <h3 className="mt-1 break-words font-bold text-slate-900">{build.name}</h3>
            <p className="mt-2 text-2xl font-bold tabular-nums text-blue-700">{build.quote?.total !== undefined ? formatUSD(build.quote.total) : '—'}</p>
            <p className="text-[11px] text-slate-500">{t('Saved estimate')} · {savedAt(build.quote?.updatedAt) || savedAt(build.updatedAt) || t('Price snapshot unavailable')}</p>
          </div>)}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[740px] border-collapse text-left text-xs">
            <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="w-40 px-4 py-3">{t('Component')}</th>
                <th scope="col" className="px-4 py-3">{a.name}</th>
                <th scope="col" className="px-4 py-3">{b.name}</th>
              </tr>
            </thead>
            <tbody>
              {PC_SLOTS.map((slot, index) => {
                const partA = slotPart(a, slot);
                const partB = slotPart(b, slot);
                const specsA = specifications(partA);
                const specsB = specifications(partB);
                return <tr key={slot} className={`border-t border-slate-100 align-top ${index % 2 ? 'bg-slate-50/50' : 'bg-white'}`}>
                  <th scope="row" className="px-4 py-4 font-semibold text-slate-600">{t(slotLabels[slot])}</th>
                  {[partA, partB].map((part, side) => {
                    const specs = side === 0 ? specsA : specsB;
                    const selectionExists = (side === 0 ? a : b).parts.some(item => item.slot === slot);
                    return <td key={side} className="max-w-[420px] break-words px-4 py-4">
                      {selectionExists ? <>
                        <p className="font-semibold text-slate-900">{part?.title || t('Saved component details unavailable')}</p>
                        <p className="mt-1 font-bold tabular-nums text-blue-700">{part ? formatUSD(part.sale_price) : '—'}</p>
                        {specs.length > 0 && <dl className="mt-2 flex flex-wrap gap-1.5">{specs.map(spec => <div key={spec.key} className="rounded-md bg-slate-100 px-2 py-1 text-[10px] leading-4 text-slate-600"><dt className="inline font-semibold">{t(spec.label)}: </dt><dd className="inline">{spec.value}</dd></div>)}</dl>}
                      </> : <span className="text-slate-400">{t('Not selected')}</span>}
                    </td>;
                  })}
                </tr>;
              })}
              <tr className="border-t border-slate-200 bg-blue-50/60">
                <th scope="row" className="px-4 py-4 font-bold text-slate-800">{t('Total price')}</th>
                <td className="px-4 py-4 text-lg font-bold tabular-nums text-blue-700">{totalA === null ? '—' : formatUSD(totalA)}</td>
                <td className="px-4 py-4 text-lg font-bold tabular-nums text-blue-700">{totalB === null ? '—' : formatUSD(totalB)}</td>
              </tr>
              <tr className="border-t border-slate-100">
                <th scope="row" className="px-4 py-4 font-semibold text-slate-600">{t('Price difference')}</th>
                <td colSpan={2} className="px-4 py-4 font-semibold text-slate-800">{difference === null ? '—' : `${difference > 0 ? '+' : ''}${formatUSD(difference)} · ${t('Build A compared with Build B')}`}</td>
              </tr>
              <tr className="border-t border-slate-100 align-top">
                <th scope="row" className="px-4 py-4 font-semibold text-slate-600">{t('Compatibility')}</th>
                {[a, b].map(build => <td key={build.id} className="px-4 py-4">
                  {build.quote?.issues?.length
                    ? <ul className="space-y-1.5">{build.quote.issues.map((issue, index) => <li key={`${index}:${issue.message}`} className={issue.level === 'error' ? 'text-rose-700' : 'text-amber-700'}>{t(issue.message)}</li>)}</ul>
                    : <span className="text-emerald-700">{t(build.quote ? 'No known blocking issues' : 'Compatibility snapshot unavailable')}</span>}
                </td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-slate-500">{t('Saved prices are snapshots and may change. Open a build to check current catalog prices and stock.')}</p>
      </div>
    </section>
  </div>;
}
