// Configuration for Google APIs
export const CONFIG = {
    // Google OAuth 2.0 settings
    GOOGLE_CLIENT_ID: '367897767302-uu5fqngr2cpb1f5fuhrdd03u9fm629ir.apps.googleusercontent.com',
    
    // Google API settings
    DISCOVERY_DOCS: [
        'https://sheets.googleapis.com/$discovery/rest?version=v4',
        'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
    ],
    SCOPES: [
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/drive.appdata',
        'https://www.googleapis.com/auth/userinfo.email'
    ].join(' '),
    
    // Application settings
    APP_NAME: 'The Stylus',
    
    // Local storage keys
    STORAGE_KEYS: {
        GURU_SIGNATURE: 'guru_signature',
        ACCESS_TOKEN: 'access_token',
        TOKEN_EXPIRY: 'token_expiry',
        USER_ID: 'user_id',
        REMEMBER_USER: 'remember_user',
        LAST_LOGIN: 'last_login',
        RECENT_PODS: 'recent_pods',
        RECENT_HUBS: 'recent_hubs',
        // Which deployment this browser should open deep links in. Absent or
        // unknown means "leave me on whichever deployment the link points at".
        PREFERRED_DEPLOYMENT: 'preferred_deployment',
    }
};

// The two GitHub Pages deployments. They share an origin (barbuz.github.io)
// and differ only by path, which is what lets them share localStorage and the
// Google appData preferences file.
export const DEPLOYMENTS = {
    production: {
        label: 'Production',
        appName: 'The Stylus',
        path: '/the-stylus/'
    },
    preview: {
        label: 'Preview',
        appName: 'The Stylus - Preview',
        path: '/the-stylus-staging/'
    }
};
