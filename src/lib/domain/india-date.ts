const dateOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
};
const timeOptions: Intl.DateTimeFormatOptions = {
  hour: 'numeric', minute: '2-digit', hour12: true,
};
const dateFormatter = new Intl.DateTimeFormat('en-IN', dateOptions);
const dateTimeFormatter = new Intl.DateTimeFormat('en-IN', { ...dateOptions, ...timeOptions });
const deadlineFormatter = new Intl.DateTimeFormat('en-IN', {
  ...dateOptions, ...timeOptions, year: undefined,
});

export function formatIndiaDate(value: string, withTime = false) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return (withTime ? dateTimeFormatter : dateFormatter).format(date);
}

export function formatIndiaDeadline(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Deadline unavailable' : deadlineFormatter.format(date);
}
