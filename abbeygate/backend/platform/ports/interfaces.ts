
export interface EmailPortAttachment {
    filename: string;
    contentBase64: string;
    mimetype?: string;
}

export interface EmailPortSendOptions {
    customArgs?: Record<string, string>;
    attachments?: EmailPortAttachment[];
}

export interface EmailPort {
    send(
        to: string,
        templateId: string,
        variables: Record<string, unknown>,
        options?: EmailPortSendOptions
    ): Promise<string>; // returns messageId
    // optional: getStatus(messageId: string): Promise<string>;
}

export interface AddressAutocompletePort {
    search(query: string): Promise<Array<Record<string, unknown>>>;
    getDetails(placeId: string): Promise<Record<string, unknown>>;
}
