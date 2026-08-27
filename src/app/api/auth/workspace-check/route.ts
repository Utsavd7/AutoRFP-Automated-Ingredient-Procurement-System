import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const body = await req.json();
  const mode = body.mode === 'signup' ? 'signup' : 'signin';
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const name = String(body.name ?? '').trim();
  const location = String(body.location ?? '').trim();
  const cuisineType = String(body.cuisineType ?? '').trim();

  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Enter a valid work email.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 });
  }

  if (mode === 'signin') {
    return NextResponse.json({ ok: true });
  }

  if (!name) return NextResponse.json({ error: 'Restaurant name is required.' }, { status: 400 });
  if (!location) return NextResponse.json({ error: 'Location is required.' }, { status: 400 });
  if (!cuisineType) return NextResponse.json({ error: 'Cuisine type is required.' }, { status: 400 });

  return NextResponse.json({ ok: true });
}
