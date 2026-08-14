import chromium from '@sparticuz/chromium';

chromium.setGraphicsMode = false;
process.stdout.write(await chromium.executablePath());
