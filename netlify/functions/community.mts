import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { getStore } from '@netlify/blobs';
import { and, count, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { getDatabase } from '../../db/index.js';
import { guilds, messages, profiles, scores } from '../../db/schema.js';

function reply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } });
}

function text(value: unknown, maximum: number) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

export default async function community(request: Request) {
  try {
    if (!['GET', 'POST', 'PUT'].includes(request.method)) return reply({ error: 'Method not allowed.' }, 405);
    const user = await getUser();
    if (!user) return reply({ error: 'Sign in to access the FireVerso community.' }, 401);
    if (!user.confirmedAt) return reply({ error: 'Confirm your email before accessing the community.' }, 403);
    if (request.method !== 'GET') {
      try { verifyRequestOrigin(request); } catch { return reply({ error: 'Request origin not allowed.' }, 403); }
    }
    const database = getDatabase();
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'profile';
    const preferredRegion = user.userMetadata?.region;
    await database.insert(profiles).values({
      userId: user.id,
      name: 'New player',
      region: typeof preferredRegion === 'string' && ['EU', 'ME', 'IN', 'BR'].includes(preferredRegion) ? preferredRegion : 'EU',
    }).onConflictDoNothing();
    const [profile] = await database.select().from(profiles).where(eq(profiles.userId, user.id));

    if (action === 'profile') {
      if (request.method === 'GET') {
        return reply({ profile });
      }
      if (request.method !== 'PUT') return reply({ error: 'Method not allowed.' }, 405);
      if (Number(request.headers.get('content-length')) > 4096) return reply({ error: 'Profile is too large.' }, 413);
      const body = await request.json();
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid profile data.' }, 400);
      const name = text(body.name, 24);
      if (!name) return reply({ error: 'Enter your player name.' }, 400);
      const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : '';
      if (!/^[0-9]{1,20}$/.test(gameId)) return reply({ error: 'Enter a Free Fire ID using up to 20 digits.' }, 400);
      const region = body.region ?? profile.region;
      if (!['EU', 'ME', 'IN', 'BR'].includes(region)) return reply({ error: 'Choose a valid server.' }, 400);
      const handle = (value: unknown) => text(value, 60).replace(/^@/, '').replace(/[^\w.]/g, '').slice(0, 30);
      const [updated] = await database.update(profiles).set({ name, gameId, region,
        bio: body.bio === undefined ? profile.bio : text(body.bio, 120),
        instagram: body.instagram === undefined ? profile.instagram : handle(body.instagram),
        tiktok: body.tiktok === undefined ? profile.tiktok : handle(body.tiktok),
      }).where(eq(profiles.userId, user.id)).returning();
      return reply({ profile: updated });
    }

    if (!profile.gameId) return reply({ error: 'Add your player name and Free Fire ID before entering the community.' }, 403);

    if (action === 'avatar') {
      const store = getStore({ name: 'fireverso-avatars', consistency: 'strong' });
      if (request.method === 'GET') {
        const memberId = url.searchParams.get('member') || user.id;
        const [member] = await database.select({ photo: profiles.photo }).from(profiles)
          .where(and(eq(profiles.userId, memberId), sql`${profiles.gameId} is not null`));
        if (!member?.photo) return reply({ error: 'Photo not found.' }, 404);
        const photo = await store.get(memberId, { type: 'arrayBuffer' });
        if (!photo) return reply({ error: 'Photo not found.' }, 404);
        return new Response(photo, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
      }
      if (request.method !== 'PUT') return reply({ error: 'Method not allowed.' }, 405);
      if (request.headers.get('content-type') !== 'image/jpeg') return reply({ error: 'Upload a JPEG image.' }, 400);
      const image = await request.arrayBuffer();
      const bytes = new Uint8Array(image);
      if (bytes.length > 200000 || bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) {
        return reply({ error: 'Upload a valid JPEG smaller than 200 KB.' }, 400);
      }
      await store.set(user.id, image);
      const photo = '/.netlify/functions/community?action=avatar';
      await database.update(profiles).set({ photo }).where(eq(profiles.userId, user.id));
      return reply({ photo });
    }

    if (action === 'guilds') {
      if (request.method === 'PUT') {
        if (Number(request.headers.get('content-length')) > 4096) return reply({ error: 'Guild listing is too large.' }, 413);
        const body = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid guild data.' }, 400);
        const name = typeof body.name === 'string' ? body.name.trim() : '';
        const gameId = typeof body.gameId === 'string' ? body.gameId.trim() : '';
        const description = typeof body.description === 'string' ? body.description.trim() : '';
        if (!name || name.length > 40) return reply({ error: 'Enter a guild name of up to 40 characters.' }, 400);
        if (!/^[0-9]{1,20}$/.test(gameId)) return reply({ error: 'Enter a guild ID using up to 20 digits.' }, 400);
        if (!['EU', 'ME', 'IN', 'BR'].includes(body.region)) return reply({ error: 'Choose a valid server.' }, 400);
        if (description.length > 240) return reply({ error: 'Keep the description within 240 characters.' }, 400);
        const values = { name, gameId, region: body.region, description, updatedAt: new Date() };
        const [guild] = await database.insert(guilds).values({ ...values, ownerId: user.id })
          .onConflictDoUpdate({ target: guilds.ownerId, set: values }).returning();
        return reply({ guild: { name: guild.name, gameId: guild.gameId, region: guild.region, description: guild.description } });
      }
      if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405);
      const region = url.searchParams.get('region') || 'ALL';
      if (!['ALL', 'EU', 'ME', 'IN', 'BR'].includes(region)) return reply({ error: 'Choose a valid server.' }, 400);
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return reply({ error: 'Invalid page.' }, 400);
      const query = text(url.searchParams.get('q'), 40).replace(/[\\%_]/g, '\\$&');
      const filter = and(sql`${profiles.gameId} is not null`, region === 'ALL' ? undefined : eq(guilds.region, region),
        query ? or(ilike(guilds.name, `%${query}%`), ilike(guilds.gameId, `%${query}%`)) : undefined);
      const listings = await database.select({ id: guilds.id, name: guilds.name, gameId: guilds.gameId,
        region: guilds.region, description: guilds.description, submittedBy: profiles.name,
      }).from(guilds).innerJoin(profiles, eq(guilds.ownerId, profiles.userId))
        .where(filter).orderBy(desc(guilds.createdAt), guilds.id).limit(13).offset(offset);
      const [own] = await database.select({ name: guilds.name, gameId: guilds.gameId, region: guilds.region,
        description: guilds.description }).from(guilds).where(eq(guilds.ownerId, user.id));
      return reply({ guilds: listings.slice(0, 12), own: own || null, hasMore: listings.length > 12 });
    }

    if (action === 'leaderboard' || action === 'members') {
      if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405);
      const region = url.searchParams.get('region') || 'ALL';
      if (!['ALL', 'EU', 'ME', 'IN', 'BR'].includes(region)) return reply({ error: 'Choose a valid server.' }, 400);
      const regionFilter = and(sql`${profiles.gameId} is not null`, region === 'ALL' ? undefined : eq(profiles.region, region));
      if (action === 'members') {
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return reply({ error: 'Invalid page.' }, 400);
        const query = text(url.searchParams.get('q'), 24).replace(/[\\%_]/g, '\\$&');
        const members = await database.select({ userId: profiles.userId, name: profiles.name, region: profiles.region,
          bio: profiles.bio, photo: profiles.photo, instagram: profiles.instagram, tiktok: profiles.tiktok,
        }).from(profiles).where(and(regionFilter, query ? ilike(profiles.name, `%${query}%`) : undefined))
          .orderBy(desc(profiles.createdAt), profiles.userId).limit(13).offset(offset);
        return reply({ members: members.slice(0, 12).map(({ userId, photo, ...member }) => ({ ...member,
          photo: photo ? `/.netlify/functions/community?action=avatar&member=${encodeURIComponent(userId)}` : '',
        })), hasMore: members.length > 12 });
      }
      const period = url.searchParams.get('period') || 'all';
      const metric = url.searchParams.get('metric') || 'points';
      if (!['today', 'week', 'all'].includes(period) || !['points', 'kills', 'wins'].includes(metric)) {
        return reply({ error: 'Invalid leaderboard filter.' }, 400);
      }
      const offset = Number(url.searchParams.get('offset') || 0);
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) return reply({ error: 'Invalid page.' }, 400);
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      if (period === 'week') start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
      const dateFilter = period === 'all' ? undefined : gte(scores.recordedAt, start);
      const points = sql<number>`coalesce(sum(${scores.rankPoints}), 0)`.mapWith(Number);
      const kills = sql<number>`coalesce(sum(${scores.kills}), 0)`.mapWith(Number);
      const winRate = sql<number>`case when coalesce(sum(${scores.matches}), 0) > 0 then round(100.0 * sum(${scores.wins}) / sum(${scores.matches}), 1) else 0 end`.mapWith(Number);
      const value = metric === 'kills' ? kills : metric === 'wins' ? winRate : points;
      const ranked = database.select({ name: profiles.name, userId: profiles.userId, region: profiles.region,
        value: value.as('value'), matches: sql<number>`coalesce(sum(${scores.matches}), 0)`.mapWith(Number).as('matches'),
        rank: sql<number>`row_number() over (order by ${value} desc, ${profiles.createdAt} asc, ${profiles.userId} asc)`.mapWith(Number).as('rank'),
      }).from(profiles).leftJoin(scores, and(eq(scores.userId, profiles.userId), dateFilter))
        .where(regionFilter).groupBy(profiles.userId).as('ranked');
      const query = text(url.searchParams.get('q'), 24).replace(/[\\%_]/g, '\\$&');
      const search = query ? ilike(ranked.name, `%${query}%`) : undefined;
      const players = await database.select().from(ranked).where(search).orderBy(ranked.rank).limit(30).offset(offset);
      const [total] = await database.select({ count: count() }).from(ranked).where(search);
      const [own] = await database.select().from(ranked).where(eq(ranked.userId, user.id));
      return reply({ players, total: total.count, own, offset, hasMore: offset + players.length < total.count,
        updatedAt: new Date().toISOString(), hasVerifiedScores: players.some(player => player.matches > 0 || player.value > 0) });
    }

    if (action === 'chat') {
      const room = url.searchParams.get('room') || 'global';
      if (!['global', 'lfg', 'ranked', 'guilds', 'styles', 'help'].includes(room)) return reply({ error: 'Unknown chat room.' }, 400);
      if (request.method === 'POST') {
        const body = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid message data.' }, 400);
        const message = text(body.body, 200);
        if (!message) return reply({ error: 'Write a message first.' }, 400);
        const mode = ['Ranked', 'Clash Squad', 'Battle Royale', 'Custom'].includes(body.mode) ? body.mode : '';
        const posted = await database.transaction(async transaction => {
          await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
          const [recent] = await transaction.select({ createdAt: messages.createdAt }).from(messages)
            .where(eq(messages.userId, user.id)).orderBy(desc(messages.createdAt)).limit(1);
          if (recent && Date.now() - recent.createdAt.getTime() < 2000) return false;
          await transaction.insert(messages).values({ userId: user.id, room, body: message, mode });
          return true;
        });
        return posted ? reply({ saved: true }, 201) : reply({ error: 'Wait a couple of seconds before sending again.' }, 429);
      }
      if (request.method !== 'GET') return reply({ error: 'Method not allowed.' }, 405);
      const history = await database.select({ id: messages.id, userId: messages.userId, name: profiles.name,
        body: messages.body, mode: messages.mode, createdAt: messages.createdAt,
      }).from(messages).innerJoin(profiles, eq(messages.userId, profiles.userId))
        .where(eq(messages.room, room)).orderBy(desc(messages.createdAt), desc(messages.id)).limit(60);
      return reply({ messages: history.reverse() });
    }
    return reply({ error: 'Not found.' }, 404);
  } catch (error) {
    if (error instanceof SyntaxError) return reply({ error: 'Invalid request data.' }, 400);
    return reply({ error: 'The community service is temporarily unavailable. Please try again.' }, 503);
  }
}
