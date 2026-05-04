import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elefant.app',
  appName: 'Elefant',
  webDir: '../desktop/dist',
  loggingBehavior: 'debug',
  server: {
    hostname: 'localhost',
    androidScheme: 'https',
    iosScheme: 'capacitor',
    allowNavigation: [],
    errorPath: 'unsupported-webview.html',
  },
  android: {
    webContentsDebuggingEnabled: true,
    minWebViewVersion: 60,
    loggingBehavior: 'debug',
    allowMixedContent: false,
  },
  plugins: {
    Keyboard: {
      resizeOnFullScreen: false,
    },
    StatusBar: {
      overlaysWebView: true,
    },
    App: {},
  },
};

export default config;
