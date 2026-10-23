/**
 * Seed script — run with:  npm run seed
 *
 * Reads SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD from the environment.
 * Refuses to run when NODE_ENV=production unless both variables are set.
 *
 * Connects via a slim TypeORM DataSource (no full NestJS app boot, no
 * Stellar config, no cache layer).
 *
 * Idempotent: lyrics are keyed on the (artist, songTitle) unique constraint.
 * Re-running updates genre, decade, difficulty, aliases and categories on
 * existing rows so older databases pick up new metadata.
 *
 * Sample players are development-only and are refused in production.
 */

import 'reflect-metadata';
import * as path from 'path';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';

// Load .env from project root so env vars are available when running via
// ts-node without a running NestJS process.
config({ path: path.resolve(__dirname, '../../.env') });

import { User } from '../users/entities/user.entity';
import { Lyrics, Genre } from '../lyrics/entities/lyrics.entity';
import { Role } from '../auth/roles/role.enum';

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-var-requires
const seedData: Array<{
  artist: string;
  songTitle: string;
  genre: string;
  decade: string;
  difficulty: number;
  content: string;
  lyricSnippet: string;
  category?: string;
  aliases?: string[];
}> = require('./seed-data.json');

// ---------------------------------------------------------------------------
// Sample players (development only)
// ---------------------------------------------------------------------------
const SAMPLE_PLAYERS: Array<{
  email: string;
  username: string;
  name: string;
  password: string;
  testnetAddress: string;
}> = [
  {
    email: 'player1@lyricflip.local',
    username: 'player1',
    name: 'Sample Player One',
    password: 'player1_local_dev',
    testnetAddress: 'GTESTNETPLACEHOLDERPLAYER1000000000000000000000000000000001',
  },
  {
    email: 'player2@lyricflip.local',
    username: 'player2',
    name: 'Sample Player Two',
    password: 'player2_local_dev',
    testnetAddress: 'GTESTNETPLACEHOLDERPLAYER2000000000000000000000000000000002',
  },
  {
    email: 'player3@lyricflip.local',
    username: 'player3',
    name: 'Sample Player Three',
    password: 'player3_local_dev',
    testnetAddress: 'GTESTNETPLACEHOLDERPLAYER3000000000000000000000000000000003',
  },
];

// ---------------------------------------------------------------------------
// Guard: refuse to run in production without explicit credentials
// ---------------------------------------------------------------------------
function resolveCredentials(): { email: string; password: string } {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (process.env.NODE_ENV === 'production') {
    if (!email || !password) {
      console.error(
        'ERROR: SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD must be set ' +
          'when running the seed in production.',
      );
      process.exit(1);
    }
  }

  return {
    email: email ?? 'admin@lyricflip.local',
    password: password ?? 'changeme_local_seed',
  };
}

// ---------------------------------------------------------------------------
// Slim DataSource — only the entities and connection we actually need
// ---------------------------------------------------------------------------
function buildDataSource(): DataSource {
  const required = (key: string): string => {
    const val = process.env[key];
    if (!val) {
      console.error(`ERROR: Required environment variable ${key} is not set.`);
      process.exit(1);
    }
    return val;
  };

  return new DataSource({
    type: 'postgres',
    host: required('DB_HOST'),
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: required('DB_USERNAME'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
    entities: [User, Lyrics],
    synchronize: false,
    logging: false,
  });
}

// ---------------------------------------------------------------------------
// Map genre string from fixture to the Genre enum
// ---------------------------------------------------------------------------
function toGenre(raw: string): Genre {
  const map: Record<string, Genre> = {
    Afrobeats: Genre.Afrobeats,
    'Hip-Hop': Genre.HipHop,
    Pop: Genre.Pop,
    Other: Genre.Other,
  };
  return map[raw] ?? Genre.Other;
}

// ---------------------------------------------------------------------------
// Main bootstrap
// ---------------------------------------------------------------------------
export async function bootstrap() {
  const { email, password } = resolveCredentials();
  const dataSource = buildDataSource();

  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const lyricsRepo = dataSource.getRepository(Lyrics);

  // ------------------------------------------------------------------
  // 1. Upsert admin user
  // ------------------------------------------------------------------
  let admin = await userRepo.findOne({ where: { email } });
  if (!admin) {
    const hashedPassword = await bcrypt.hash(password, 12);
    admin = userRepo.create({
      email,
      username: 'seedadmin',
      name: 'Seed Admin',
      passwordHash: hashedPassword,
      role: Role.Admin,
    });
    admin = await userRepo.save(admin);
    console.log(`Created admin user: ${email}`);
  } else {
    // Ensure role is set even if the row already existed without it
    if (admin.role !== Role.Admin) {
      admin.role = Role.Admin;
      await userRepo.save(admin);
      console.log(`Updated existing user to admin role: ${email}`);
    } else {
      console.log(`Admin user already exists: ${email}`);
    }
  }

  // ------------------------------------------------------------------
  // 2. Upsert lyrics — keyed on (artist, songTitle) unique constraint.
  //    Existing rows get genre/decade/difficulty/category/aliases refreshed.
  // ------------------------------------------------------------------
  let created = 0;
  let updated = 0;

  for (const entry of seedData) {
    const existing = await lyricsRepo.findOne({
      where: { artist: entry.artist, songTitle: entry.songTitle },
    });

    if (existing) {
      existing.genre = toGenre(entry.genre);
      existing.decade = entry.decade;
      existing.difficulty = entry.difficulty;
      existing.category = entry.category ?? existing.category ?? null;
      existing.aliases = entry.aliases ?? [];
      await lyricsRepo.save(existing);
      updated++;
      continue;
    }

    await lyricsRepo.save(
      lyricsRepo.create({
        content: entry.content,
        lyricSnippet: entry.lyricSnippet,
        songTitle: entry.songTitle,
        artist: entry.artist,
        genre: toGenre(entry.genre),
        decade: entry.decade,
        difficulty: entry.difficulty,
        category: entry.category ?? null,
        aliases: entry.aliases ?? [],
        createdBy: { id: admin.id },
      }),
    );
    created++;
  }

  console.log(
    `Lyrics: ${created} created, ${updated} updated (${seedData.length} total).`,
  );

  // ------------------------------------------------------------------
  // 3. Sample players — development only
  // ------------------------------------------------------------------
  const isProduction = process.env.NODE_ENV === 'production';
  const samplePlayerLines: string[] = [];

  if (isProduction) {
    console.log('Skipping sample players: NODE_ENV=production.');
  } else {
    for (const sample of SAMPLE_PLAYERS) {
      let player = await userRepo.findOne({ where: { email: sample.email } });
      if (!player) {
        player = userRepo.create({
          email: sample.email,
          username: sample.username,
          name: sample.name,
          passwordHash: await bcrypt.hash(sample.password, 12),
          role: Role.User,
          walletAddress: sample.testnetAddress,
        });
        player = await userRepo.save(player);
        console.log(`Created sample player: ${sample.email}`);
      } else {
        console.log(`Sample player already exists: ${sample.email}`);
      }
      samplePlayerLines.push(
        `  ${sample.email}  password=${sample.password}  wallet=${sample.testnetAddress}`,
      );
    }
  }

  console.log('Seeding complete.');

  if (samplePlayerLines.length > 0) {
    console.log('\nSample players (development only):');
    console.log(samplePlayerLines.join('\n'));
  }

  await dataSource.destroy();
}

// Only execute when invoked directly (npm run seed), not when imported by specs.
if (require.main === module) {
  bootstrap().catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
}
