import { bootstrapApplication } from '@angular/platform-browser';
import { App } from './app/app';
import { startApp } from './app/config/app-config';

void startApp({
  root: document.querySelector('app-root'),
  fetchFn: fetch,
  bootstrap: (providers) => bootstrapApplication(App, { providers }),
  logError: (error) => {
    console.error(error);
  },
});
