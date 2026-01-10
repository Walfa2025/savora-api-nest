import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { stringify as yamlStringify } from 'yaml';

import { AppModule } from '../src/app.module';

async function run() {
  // No need to listen on a port; we only want the OpenAPI document.
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Savora API')
    .setDescription('Savora backend (api_nest)')
    .setVersion(process.env.OPENAPI_VERSION ?? '0.0.1')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  const jsonPath =
    process.env.OPENAPI_JSON_PATH || path.resolve(process.cwd(), 'openapi.json');
  const yamlPath =
    process.env.OPENAPI_YAML_PATH || path.resolve(process.cwd(), 'openapi.yaml');

  fs.writeFileSync(jsonPath, JSON.stringify(document, null, 2), 'utf8');
  fs.writeFileSync(yamlPath, yamlStringify(document), 'utf8');

  // eslint-disable-next-line no-console
  console.log(`WROTE ${jsonPath}`);
  // eslint-disable-next-line no-console
  console.log(`WROTE ${yamlPath}`);

  await app.close();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
