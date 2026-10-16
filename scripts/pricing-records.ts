import type { PricingRecord } from '../src/main/lambda/handlers/interfaces';

export const pricingRecords: PricingRecord[] = [
    {
        pricingId: 'STANDARD_RATES',
        name: 'Standard Peak Rates',
        currency: 'GBP',
        ticketTiers: [
            { id: 'adult', label: 'Standard Adult', description: 'Standard adult admission', price: 9.5 },
            { id: 'child', label: 'Child Ticket', description: 'Child admission', price: 6 },
            { id: 'student', label: 'Student Ticket', description: 'Student admission', price: 7.5 },
            { id: 'senior', label: 'Senior / OAP', description: 'Senior admission', price: 7 },
        ],
    },
    {
        pricingId: 'OFF_PEAK_RATES',
        name: 'Off-Peak Rates',
        currency: 'GBP',
        ticketTiers: [
            { id: 'adult', label: 'Standard Adult', description: 'Off-peak adult admission', price: 7.6 },
            { id: 'child', label: 'Child Ticket', description: 'Off-peak child admission', price: 4.8 },
            { id: 'student', label: 'Student Ticket', description: 'Off-peak student admission', price: 6 },
            { id: 'senior', label: 'Senior / OAP', description: 'Off-peak senior admission', price: 5.6 },
        ],
    },
    {
        pricingId: 'KIDS_CLUB_RATES',
        name: 'Kids Club Rates',
        currency: 'GBP',
        ticketTiers: [
            { id: 'child', label: 'Kids Club Child Ticket', description: 'Kids Club admission per child', price: 2.5 },
            { id: 'adult', label: 'Adult Companion', description: 'Adult admission with a Kids Club child ticket', price: 0 },
        ],
    },
    {
        pricingId: 'STUDENT_NIGHT_RATES',
        name: 'Student Night Rates',
        currency: 'GBP',
        ticketTiers: [
            { id: 'student', label: 'Student Ticket', description: 'Valid student ID required', price: 2.5 },
        ],
    },
    {
        pricingId: 'BIRTHDAY_PARTY_RATES',
        name: 'Birthday Party Rates',
        currency: 'GBP',
        ticketTiers: [
            {
                id: 'child-party-package',
                label: 'Child Party Package',
                description: 'Includes film, popcorn and soft drink',
                price: 6,
            },
        ],
    },
    {
        pricingId: 'CRAZY_TUESDAY_RATES',
        name: 'Crazy Tuesday Rates',
        currency: 'GBP',
        ticketTiers: [
            {
                id: 'crazy-tuesday',
                label: 'Crazy Tuesday Ticket',
                description: 'Admission for any Tuesday movie showing',
                price: 4,
            },
        ],
    },
];
