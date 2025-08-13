export const camelCase = (value: string): string => {
    return value
        .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^[A-Z]/, c => c.toLowerCase());
};

export const capitalize = (value: string): string => {
    return value.charAt(0).toUpperCase() + value.slice(1);
};
