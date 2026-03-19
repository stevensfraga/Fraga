import { toZonedTime, format } from 'date-fns-tz';

// Simulando o dueDate como vem do banco
// "Thu Jan 02 2025 19:00:00 GMT-0500" = 2025-01-03 00:00:00 UTC
const dueDateString = "2025-01-03T00:00:00.000Z"; // ISO UTC
const dueDate = new Date(dueDateString);

console.log("Original dueDate (UTC):", dueDate.toISOString());
console.log("Original dueDate (toString):", dueDate.toString());

// Conversão com date-fns-tz
const zonedDueDate = toZonedTime(dueDate, 'America/Sao_Paulo');
console.log("Zoned dueDate (America/Sao_Paulo):", zonedDueDate.toString());

const formattedDueDate = format(zonedDueDate, 'dd/MM/yyyy');
console.log("Formatted dueDate:", formattedDueDate);

// Comparar com toLocaleDateString
console.log("toLocaleDateString('pt-BR'):", dueDate.toLocaleDateString('pt-BR'));
