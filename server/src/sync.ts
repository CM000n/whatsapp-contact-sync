import { WebSocket } from "ws";
import { Auth } from "googleapis";
import { RateLimiter } from "limiter";
import { Client } from "whatsapp-web.js";

import { EventType, SyncOptions } from "../../interfaces/api";
import { listContacts, updateContactPhoto } from "./gapi";
import { downloadFile, loadContacts } from "./whatsapp";
import { sendEvent } from "./ws";
import { SimpleContact } from "./interfaces";
import { getFromCache } from "./cache";

export async function initSync(id: string, syncOptions: SyncOptions) {
  // The limiter is implemented due to Google API's limit of 60 photo uploads per minute per user
  const limiter = new RateLimiter({ tokensPerInterval: 1, interval: 1500 });

  const ws: WebSocket = getFromCache(id, "ws");
  const whatsappClient: Client = getFromCache(id, "whatsapp");
  const gAuth: Auth.OAuth2Client = getFromCache(id, "gauth");

  const googleContacts: SimpleContact[] = await listContacts(gAuth);
  const whatsappContacts: SimpleContact[] = await loadContacts(whatsappClient);

  let syncCount: number = 0;
  let photo: string | null = null;

  for (const [index, googleContact] of googleContacts.entries()) {
    if (ws.readyState !== WebSocket.OPEN) return; // Stop sync if user disconnected.

    if (syncOptions.overwrite_photos === "false" && googleContact.hasPhoto)
      continue;

    for (const phoneNumber of googleContact.numbers) {
      const whatsappContact = whatsappContacts.find((contact) =>
        contact.numbers.includes(phoneNumber)
      );
      if (!whatsappContact) continue;

      photo = await downloadFile(whatsappClient, whatsappContact.id);
      if (photo === null) break;

      await limiter.removeTokens(1);
      await updateContactPhoto(gAuth, googleContact.id, photo);
      syncCount++;

      break;
    }

    sendEvent(ws, EventType.SyncProgress, {
      progress: (index / googleContacts.length) * 100,
      syncCount: syncCount,
      totalContacts: googleContacts.length,
      image: photo,
    });
    photo = null;
  }

  sendEvent(ws, EventType.SyncProgress, {
    progress: 100,
    syncCount: syncCount,
  });

  ws.close();
}
