/**
 * People Scan Router - Scan all pessoas to find specific person
 * FIXED: Use correct API params (pagina, tamanho_pagina) and response format (items, totalItems)
 */

import { Router } from 'express';
import axios from 'axios';
import { getValidAccessToken } from './contaAzulOAuthManager';

const router = Router();

function devOnly(req: any, res: any): boolean {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ success: false, error: 'NOT_FOUND' });
  }

  const devSecret = process.env.DEV_SECRET;
  const headerSecret = req.headers['x-dev-secret'];
  
  if (!devSecret || devSecret !== headerSecret) {
    return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  }

  return true;
}

/**
 * GET /people-scan?email=...&pagina=1&tamanho_pagina=100
 * Scan all pessoas and find specific email using CORRECT API params
 */
router.get('/people-scan', async (req: any, res: any) => {
  if (!devOnly(req, res)) return;

  try {
    const targetEmail = (req.query.email as string) || 'api.teste+20260214@fraga.com';
    const pagina = parseInt(req.query.pagina as string) || 1;
    const tamanho_pagina = parseInt(req.query.tamanho_pagina as string) || 100;
    
    console.log(`[PeopleScan] START email=${targetEmail} pagina=${pagina} tamanho_pagina=${tamanho_pagina}`);
    
    // Get valid access token
    const accessToken = await getValidAccessToken();
    const tokenSuffix = accessToken.substring(0, 20);
    console.log(`[OAuth] TOKEN_USED suffix=${tokenSuffix}...`);

    // Build query params using CORRECT API params
    const params = new URLSearchParams({
      pagina: pagina.toString(),
      tamanho_pagina: tamanho_pagina.toString(),
    });

    // Add email filter if provided
    if (targetEmail) {
      params.append('emails', targetEmail);
    }

    const endpoint = `https://api-v2.contaazul.com/v1/pessoas?${params.toString()}`;
    console.log(`[PeopleScan] FETCH url=${endpoint}`);

    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    console.log(`[PeopleScan] RESPONSE status=${response.status}`);

    // Parse response using CORRECT format: { items: [...], totalItems: N }
    const data = response.data || {};
    const items = data.items || data.data || [];
    const totalItems = data.totalItems || data.total || 0;
    const itemsCount = items.length;
    
    console.log(`[PeopleScan] RESPONSE totalItems=${totalItems} itemsCount=${itemsCount}`);

    // Search for target email
    let foundEmail = false;
    let foundPersonId = null;
    let foundPerson = null;

    for (const person of items) {
      // Check if email matches (case insensitive)
      // API can return email as string or array of objects
      const personEmails = person.emails || [];
      const emailsToCheck = Array.isArray(personEmails) 
        ? personEmails.map((e: any) => typeof e === 'string' ? e : e.email)
        : [person.email];

      for (const email of emailsToCheck) {
        if (email && email.toLowerCase() === targetEmail.toLowerCase()) {
          foundEmail = true;
          foundPersonId = person.id;
          foundPerson = person;
          console.log(`[PeopleScan] FOUND email=${email} personId=${foundPersonId}`);
          break;
        }
      }
      if (foundEmail) break;
    }

    if (!foundEmail) {
      console.log(`[PeopleScan] NOT_FOUND email=${targetEmail}`);
    }

    res.json({
      success: true,
      apiStatus: response.status,
      totalItems,
      itemsCount,
      foundEmail,
      foundPersonId,
      foundPerson,
      targetEmail,
      allPeople: items.map((p: any) => ({
        id: p.id,
        name: p.name || p.nome,
        emails: p.emails || [p.email],
      })),
    });
  } catch (error: any) {
    const status = error.response?.status;
    const errorData = error.response?.data;
    
    console.error(`[PeopleScan] ERROR status=${status}`);
    console.error(`[PeopleScan] ERROR_DATA`, JSON.stringify(errorData));
    
    res.json({
      success: false,
      error: error?.message,
      apiStatus: status,
      errorData,
    });
  }
});

export default router;
