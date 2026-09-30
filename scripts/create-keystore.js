#!/usr/bin/env node
/**
 * Creates the upload keystore used to sign release APKs / AABs and writes
 * android/keystore.properties. keytool prompts for the passwords and your details.
 *
 * Back up the .keystore file and passwords: Play needs the same upload key for every update.
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.resolve(__dirname, '..');
const keystoreName = 'filehop-upload.keystore';
const alias = 'filehop-upload';
const keystorePath = path.join(root, 'android', 'app', keystoreName);
const propsPath = path.join(root, 'android', 'keystore.properties');

if (fs.existsSync(keystorePath)) {
  console.error(
    `${path.relative(
      root,
      keystorePath,
    )} already exists. Delete it first if you really want a new key.`,
  );
  process.exit(1);
}

const keytool = process.env.JAVA_HOME
  ? path.join(
      process.env.JAVA_HOME,
      'bin',
      process.platform === 'win32' ? 'keytool.exe' : 'keytool',
    )
  : 'keytool';

const ask = question =>
  new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });

(async () => {
  const password = await ask(
    'Choose a keystore password (min 6 chars, used for both store and key): ',
  );
  if (password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }

  const result = spawnSync(
    keytool,
    [
      '-genkeypair',
      '-v',
      '-storetype',
      'PKCS12',
      '-keystore',
      keystorePath,
      '-alias',
      alias,
      '-keyalg',
      'RSA',
      '-keysize',
      '2048',
      '-validity',
      '10000',
      '-storepass',
      password,
      '-keypass',
      password,
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) {
    console.error('keytool failed.');
    process.exit(result.status ?? 1);
  }

  fs.writeFileSync(
    propsPath,
    [
      `storeFile=${keystoreName}`,
      `storePassword=${password}`,
      `keyAlias=${alias}`,
      `keyPassword=${password}`,
      '',
    ].join('\n'),
  );
  console.log(
    `\nCreated android/app/${keystoreName} and android/keystore.properties (both gitignored).`,
  );
  console.log(
    'Back them up somewhere safe. Losing the upload key blocks Play updates.',
  );
})();
