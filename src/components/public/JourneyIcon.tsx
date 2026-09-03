import {
  BadgeCheck,
  Camera,
  Columns3,
  History,
  IndianRupee,
  Link2,
  ListChecks,
  ReceiptText,
  ShieldCheck,
  Truck,
  Upload,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

const journeyIcons = {
  approve: BadgeCheck,
  camera: Camera,
  compare: Columns3,
  history: History,
  price: IndianRupee,
  link: Link2,
  list: ListChecks,
  receipt: ReceiptText,
  privacy: ShieldCheck,
  delivery: Truck,
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
