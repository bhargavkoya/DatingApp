import { Pipe, PipeTransform } from '@angular/core';

// Replaces ngx-timeago (View Engine only — breaks once ngcc is removed in Angular 16).
// Same intent: render a past timestamp as a relative "x ago" string. Buckets/wording
// mirror what ngx-timeago produced closely enough for the message/last-active labels.
@Pipe({ name: 'timeago', standalone: true })
export class TimeagoPipe implements PipeTransform {
  transform(value: string | Date | null | undefined): string {
    if (!value) return '';

    const then = new Date(value).getTime();
    if (isNaN(then)) return '';

    const seconds = Math.round((Date.now() - then) / 1000);
    if (seconds < 0) return 'just now';

    const minutes = Math.round(seconds / 60);
    const hours = Math.round(minutes / 60);
    const days = Math.round(hours / 24);
    const months = Math.round(days / 30);
    const years = Math.round(days / 365);

    if (seconds < 45) return 'less than a minute ago';
    if (seconds < 90) return 'about a minute ago';
    if (minutes < 45) return `${minutes} minutes ago`;
    if (minutes < 90) return 'about an hour ago';
    if (hours < 24) return `about ${hours} hours ago`;
    if (hours < 42) return 'a day ago';
    if (days < 30) return `${days} days ago`;
    if (days < 45) return 'about a month ago';
    if (months < 12) return `${months} months ago`;
    if (years < 2) return 'about a year ago';
    return `${years} years ago`;
  }
}
