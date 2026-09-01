'use client';

import {
  BookOpenCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import type {
  TutorialAction,
  TutorialStateDto,
} from '@/lib/tutorial/tutorial-state';

import styles from './tutorial-guide.module.css';

export const TUTORIAL_STEPS = [
  {
    title: 'See what needs attention',
    instruction:
      'Look at Overview first. It shows open requests, quotes waiting, and the work that needs attention today.',
    action: 'Open overview',
    href: '/dashboard',
  },
  {
    title: 'Add your menu',
    instruction:
      'Click Menus, then Add menu. Paste your list, upload menu photos, or use a permitted website link. Check the dish names before saving.',
    action: 'Open menus',
    href: '/menus',
  },
  {
    title: 'Add the vendors you trust',
    instruction:
      'Click Suppliers. Add the vendors you already buy from and choose what each vendor supplies.',
    action: 'Open suppliers',
    href: '/suppliers',
  },
  {
    title: 'Ask for prices',
    instruction:
      'Click New request. Pick items, enter quantity and delivery date, then choose saved suppliers or invite new verified suppliers.',
    action: 'Create a request',
    href: '/procurement/new',
  },
  {
    title: 'Choose with the full cost',
    instruction:
      'Click Procurement. Open a request, compare final cost and delivery details, then record the supplier you choose.',
    action: 'Compare quotes',
    href: '/procurement',
  },
  {
    title: 'Use your buying history',
    instruction:
      'Click Insights to review spending and supplier performance. Your saved requests, quotes, and decisions help with the next purchase.',
    action: 'Open insights',
    href: '/insights',
  },
] as const;

type TutorialResponse = { tutorial?: TutorialStateDto };

async function readTutorial(): Promise<TutorialStateDto> {
  const response = await fetch('/api/tutorial', { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load setup guide');
  const body = (await response.json()) as TutorialResponse;
  if (!body.tutorial) throw new Error('Setup guide response was incomplete');
  return body.tutorial;
}

export function TutorialGuide({
  initialTutorial,
}: {
  initialTutorial?: TutorialStateDto;
}) {
  const [tutorial, setTutorial] = useState<TutorialStateDto | null>(
    initialTutorial ?? null,
  );
  const [expanded, setExpanded] = useState(
    Boolean(
      initialTutorial &&
        !initialTutorial.skippedAt &&
        !initialTutorial.completedAt,
    ),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    try {
      const next = await readTutorial();
      setTutorial(next);
      setExpanded(!next.skippedAt && !next.completedAt);
    } catch {
      // The workspace remains usable when the optional guide is unavailable.
    }
  }, []);

  useEffect(() => {
    if (initialTutorial) return;
    let active = true;
    readTutorial()
      .then((next) => {
        if (!active) return;
        setTutorial(next);
        setExpanded(!next.skippedAt && !next.completedAt);
      })
      .catch(() => {
        // The workspace remains usable when the optional guide is unavailable.
      });
    return () => {
      active = false;
    };
  }, [initialTutorial]);

  async function apply(action: TutorialAction) {
    if (!tutorial || saving) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/tutorial', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          expectedVersion: tutorial.version,
          action,
        }),
      });
      if (response.status === 409) {
        await refresh();
        setMessage('Progress was refreshed. Please try again.');
        return;
      }
      if (!response.ok) throw new Error('Unable to update setup guide');
      const body = (await response.json()) as TutorialResponse;
      if (!body.tutorial) throw new Error('Setup guide response was incomplete');
      setTutorial(body.tutorial);
      setExpanded(action !== 'SKIP' && action !== 'COMPLETE');
    } catch {
      setMessage('Could not save your progress. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  if (!tutorial) return null;

  const stepIndex = Math.min(tutorial.step, TUTORIAL_STEPS.length - 1);
  const step = TUTORIAL_STEPS[stepIndex];
  const finished = Boolean(tutorial.completedAt);

  if (!expanded) {
    return (
      <aside className={styles.resume} aria-label="Setup guide">
        <span className={finished ? styles.resumeIconDone : styles.resumeIcon}>
          {finished ? <Check aria-hidden="true" /> : <BookOpenCheck aria-hidden="true" />}
        </span>
        <span className={styles.resumeCopy}>
          <strong>{finished ? 'Setup complete' : `Step ${stepIndex + 1} of ${TUTORIAL_STEPS.length}`}</strong>
          <small>{finished ? 'Review the guide any time' : 'Continue when you are ready'}</small>
        </span>
        <button
          disabled={saving}
          onClick={() => void apply(finished ? 'RESTART' : 'RESUME')}
          type="button"
        >
          {finished ? <RotateCcw aria-hidden="true" /> : null}
          {finished ? 'Show setup guide' : 'Continue setup'}
        </button>
      </aside>
    );
  }

  return (
    <aside className={styles.guide} aria-label="Setup guide" aria-live="polite">
      <div className={styles.heading}>
        <span className={styles.guideIcon}><BookOpenCheck aria-hidden="true" /></span>
        <span>
          <strong>Setup guide</strong>
          <small>About two minutes</small>
        </span>
        <span className={styles.counter}>Step {stepIndex + 1} of {TUTORIAL_STEPS.length}</span>
      </div>

      <div className={styles.progress} aria-hidden="true">
        {TUTORIAL_STEPS.map((item, index) => (
          <span
            className={index <= stepIndex ? styles.progressDone : styles.progressRest}
            key={item.href}
          />
        ))}
      </div>

      <div className={styles.body}>
        <p className={styles.kicker}>What to click</p>
        <h2>{step.title}</h2>
        <p>{step.instruction}</p>
        <Link className={styles.destination} href={step.href}>
          {step.action}
          <ChevronRight aria-hidden="true" />
        </Link>
      </div>

      {message ? <p className={styles.message} role="status">{message}</p> : null}

      <div className={styles.actions}>
        <button
          className={styles.back}
          disabled={saving || stepIndex === 0}
          onClick={() => void apply('BACK')}
          type="button"
        >
          <ChevronLeft aria-hidden="true" /> Back
        </button>
        <button
          className={styles.skip}
          disabled={saving}
          onClick={() => void apply('SKIP')}
          type="button"
        >
          Skip for now
        </button>
        <button
          className={styles.next}
          disabled={saving}
          onClick={() => void apply(stepIndex === tutorial.lastStep ? 'COMPLETE' : 'NEXT')}
          type="button"
        >
          {stepIndex === tutorial.lastStep ? 'Finish' : 'Next'}
          {stepIndex === tutorial.lastStep ? <Check aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
      </div>
    </aside>
  );
}
