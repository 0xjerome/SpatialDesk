import { render } from 'preact';
// Installs the Preact integration so components re-render when signals change.
import '@preact/signals';
import { signal } from '@preact/signals-core';
import { AssistantClient } from './ai/client';
import { WorkspaceStore } from './domain/store';
import { createSpeechProvider } from './voice/provider';
import { XrController } from './xr/controller';
import { App } from './app/App';
import { AppContext, Toaster, type AppServices } from './app/context';
import { Router } from './app/router';
import { applyTheme } from './app/theme';
import './app/styles.css';

applyTheme();

const store = new WorkspaceStore();
const speech = createSpeechProvider();
const services: AppServices = {
  store,
  assistant: new AssistantClient(),
  speech,
  router: new Router(),
  toaster: new Toaster(),
  voiceOpen: signal(false),
  xr: new XrController({
    store,
    speech,
    container: () => document.getElementById('scene-container'),
  }),
};
services.router.start();

// Exposed for end-to-end tests and debugging only; carries no secrets.
declare global {
  interface Window {
    __spatialdesk?: AppServices;
  }
}
window.__spatialdesk = services;

render(
  <AppContext.Provider value={services}>
    <App />
  </AppContext.Provider>,
  document.getElementById('app') as HTMLElement,
);
