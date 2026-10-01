import "server-only";

import { randomUUID } from "node:crypto";
import { genSaltSync, hashSync } from "bcrypt-ts";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { user } from "./schema";

const client = postgres(process.env.POSTGRES_URL ?? "");
const db = drizzle(client);

export function createGuestUser() {
  const email = `guest-${randomUUID()}`;
  const password = hashSync(randomUUID(), genSaltSync(10));
  return db.insert(user).values({ email, password }).returning({
    email: user.email,
    id: user.id,
  });
}
