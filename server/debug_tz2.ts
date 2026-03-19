import { format } from 'date-fns';

// Simulando o dueDate como vem do banco
// "Thu Jan 02 2025 19:00:00 GMT-0500" = 2025-01-03 00:00:00 UTC
const dueDateString = "2025-01-03T00:00:00.000Z"; // ISO UTC
const dueDate = new Date(dueDateString);

console.log("Original dueDate (UTC):", dueDate.toISOString());
console.log("Formatted com format():", format(dueDate, 'dd/MM/yyyy'));

// Testar com UTC offset
const utcDate = new Date(dueDate.getTime() + dueDate.getTimezoneOffset() * 60000);
console.log("Adjusted for UTC:", format(utcDate, 'dd/MM/yyyy'));
