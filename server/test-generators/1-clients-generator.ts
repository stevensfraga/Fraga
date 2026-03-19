/**
 * Gerador 1: Clientes de Teste
 * Cria 50 clientes fictícios com dados realistas
 */

import { getDb } from "../db";
import { clients } from "../../drizzle/schema";

const FIRST_NAMES = [
  "João", "Maria", "Pedro", "Ana", "Carlos", "Fernanda", "Ricardo", "Juliana",
  "Marcos", "Patricia", "Felipe", "Beatriz", "André", "Camila", "Bruno"
];

const LAST_NAMES = [
  "Silva", "Santos", "Oliveira", "Souza", "Costa", "Ferreira", "Rodrigues",
  "Martins", "Gomes", "Alves", "Pereira", "Carvalho", "Barbosa", "Ribeiro"
];

const CITIES = [
  "São Paulo", "Rio de Janeiro", "Belo Horizonte", "Brasília", "Salvador",
  "Fortaleza", "Manaus", "Curitiba", "Recife", "Porto Alegre"
];

const STATES = ["SP", "RJ", "MG", "DF", "BA", "CE", "AM", "PR", "PE", "RS"];

export async function generateTestClients() {
  try {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    console.log("[Test Generator 1] 🚀 Gerando 50 clientes de teste...");

    const clientsToInsert = [];
    for (let i = 1; i <= 50; i++) {
      const firstName = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
      const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
      const city = CITIES[Math.floor(Math.random() * CITIES.length)];
      const state = STATES[Math.floor(Math.random() * STATES.length)];

      clientsToInsert.push({
        name: `${firstName} ${lastName}`,
        contaAzulId: `conta-azul-${i}`,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
        phone: `${11 + Math.floor(Math.random() * 80)} 9${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
        whatsappNumber: `55${11 + Math.floor(Math.random() * 80)}9${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
        city,
        state,
        cnae: `${Math.floor(Math.random() * 9000) + 1000}`,
        status: "active" as const,
        createdAt: new Date(),
      });
    }

    await db.insert(clients).values(clientsToInsert);
    console.log("[Test Generator 1] ✅ 50 clientes criados com sucesso!");
    return clientsToInsert.length;
  } catch (error: any) {
    console.error("[Test Generator 1] ❌ Erro:", error.message);
    throw error;
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  generateTestClients()
    .then((count) => {
      console.log(`\n✅ Gerador 1 concluído: ${count} clientes criados`);
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Erro no gerador 1:", error);
      process.exit(1);
    });
}
