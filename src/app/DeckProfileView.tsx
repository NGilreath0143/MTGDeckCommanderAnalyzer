'use client';

import type { CardType, DeckProfile } from '@/domain/types';

/** Renders a DeckProfile. Presentation only — no analysis logic here. */

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

function BarChart({ data }: { data: [string, number][] }) {
  const max = Math.max(1, ...data.map(([, v]) => v));
  return (
    <div className="bars">
      {data.map(([key, value]) => (
        <div className="bar-row" key={key}>
          <span>{key}</span>
          <div className="bar" style={{ width: `${(value / max) * 100}%` }} />
          <span className="count">{value}</span>
        </div>
      ))}
    </div>
  );
}

export function DeckProfileView({ profile }: { profile: DeckProfile }) {
  const { stats, validation } = profile;

  const typeRows = (Object.entries(stats.typeDistribution) as [CardType, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const colorRows = Object.entries(stats.colorDistribution).filter(([, v]) => v > 0);

  return (
    <>
      <div className="panel">
        <h2>
          Validation{' '}
          <span className={`badge ${validation.valid ? 'ok' : 'bad'}`}>
            {validation.valid ? 'Legal' : `${validation.issues.length} issue(s)`}
          </span>
        </h2>

        {profile.commanders.length > 0 ? (
          <p style={{ marginTop: 0 }}>
            Commander:{' '}
            <strong>{profile.commanders.map((c) => c.name).join(' + ')}</strong>{' '}
            <span style={{ color: 'var(--muted)' }}>
              ({profile.commanders.flatMap((c) => c.colorIdentity).join('') || 'colorless'})
            </span>
          </p>
        ) : (
          <p style={{ marginTop: 0, color: 'var(--muted)' }}>No commander identified.</p>
        )}

        {validation.issues.length > 0 && (
          <ul className="issues">
            {validation.issues.map((issue, i) => (
              <li key={`${issue.code}-${i}`} className={issue.severity}>
                <code>{issue.code}</code> — {issue.message}
              </li>
            ))}
          </ul>
        )}

        {profile.parseErrors.length > 0 && (
          <>
            <h2 style={{ marginTop: '1rem' }}>Unparsed lines</h2>
            <ul className="issues">
              {profile.parseErrors.map((e) => (
                <li key={e.lineNumber} className="warning">
                  Line {e.lineNumber}: <code>{e.raw}</code> — {e.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="panel">
        <h2>Overview</h2>
        <div className="grid">
          <Stat label="Total cards" value={stats.totalCards} />
          <Stat label="Lands" value={stats.landCount} />
          <Stat label="Nonlands" value={stats.nonlandCount} />
          <Stat label="Avg mana value" value={stats.averageManaValue} />
        </div>
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem', marginBottom: 0 }}>
          Average mana value covers nonland, non-commander cards.
        </p>
      </div>

      <div className="cols">
        <div className="panel">
          <h2>Mana curve</h2>
          <BarChart data={Object.entries(stats.manaCurve)} />
        </div>

        <div className="panel">
          <h2>Card types</h2>
          <BarChart data={typeRows} />
        </div>

        <div className="panel">
          <h2>Mana pips</h2>
          <BarChart data={colorRows} />
        </div>

        <div className="panel">
          <h2>Colour identity</h2>
          <BarChart
            data={Object.entries(stats.colorIdentityDistribution).filter(([, v]) => v > 0)}
          />
        </div>
      </div>

      {profile.unresolved.length > 0 && (
        <div className="panel">
          <h2>Unresolved cards</h2>
          <ul className="issues">
            {profile.unresolved.map((u) => (
              <li key={u.name} className="warning">
                {u.quantity}× {u.name} — {u.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {profile.deckId && (
        <p style={{ color: 'var(--muted)', fontSize: '0.8rem' }}>
          Saved as deck <code>{profile.deckId}</code>
        </p>
      )}
    </>
  );
}
