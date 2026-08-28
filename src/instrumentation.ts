export async function register() {
  if (
    process.env.NEXT_RUNTIME !== 'nodejs'
    || process.env.QUOTEPLATE_RUNTIME_STARTUP_CHECK !== '1'
  ) {
    return;
  }

  const { validateRuntimeEnvironment } = await import('@/lib/env');
  validateRuntimeEnvironment(process.env);
}
