import {
  BadgeCheck,
  Camera,
  History,
  IndianRupee,
  Link2,
  ListChecks,
  ReceiptText,
  ShieldCheck,
  Upload,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

const journeyIcons = {
  approve: BadgeCheck,
  camera: Camera,
  history: History,
  price: IndianRupee,
  link: Link2,
  list: ListChecks,
  receipt: ReceiptText,
  privacy: ShieldCheck,
  upload: Upload,
  suppliers: UsersRound,
} satisfies Record<string, LucideIcon>;

export type JourneyIconName = keyof typeof journeyIcons;

export function JourneyIcon({ name }: { name: JourneyIconName }) {
  const Icon = journeyIcons[name];

  return (
    <span className="journey-icon" aria-hidden="true">
      <Icon size={22} strokeWidth={1.8} />
    </span>
  );
}
