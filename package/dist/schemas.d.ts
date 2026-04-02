import { z } from 'zod';

declare const OpenApiPaymentInfoSchema: z.ZodObject<{
    pricingMode: z.ZodOptional<z.ZodString>;
    price: z.ZodOptional<z.ZodString>;
    minPrice: z.ZodOptional<z.ZodString>;
    maxPrice: z.ZodOptional<z.ZodString>;
    protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
    intent: z.ZodOptional<z.ZodString>;
    method: z.ZodOptional<z.ZodString>;
    amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
    currency: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$loose>;
declare const OpenApiOperationSchema: z.ZodObject<{
    operationId: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
    security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
    parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
        in: z.ZodString;
        name: z.ZodString;
        schema: z.ZodOptional<z.ZodUnknown>;
        required: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
    requestBody: z.ZodOptional<z.ZodObject<{
        required: z.ZodOptional<z.ZodBoolean>;
        content: z.ZodRecord<z.ZodString, z.ZodObject<{
            schema: z.ZodOptional<z.ZodUnknown>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
    responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    'x-payment-info': z.ZodOptional<z.ZodObject<{
        pricingMode: z.ZodOptional<z.ZodString>;
        price: z.ZodOptional<z.ZodString>;
        minPrice: z.ZodOptional<z.ZodString>;
        maxPrice: z.ZodOptional<z.ZodString>;
        protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
        intent: z.ZodOptional<z.ZodString>;
        method: z.ZodOptional<z.ZodString>;
        amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
        currency: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$loose>>;
}, z.core.$strip>;
declare const OpenApiPathItemSchema: z.ZodObject<{
    get: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            in: z.ZodString;
            name: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        requestBody: z.ZodOptional<z.ZodObject<{
            required: z.ZodOptional<z.ZodBoolean>;
            content: z.ZodRecord<z.ZodString, z.ZodObject<{
                schema: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        'x-payment-info': z.ZodOptional<z.ZodObject<{
            pricingMode: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            minPrice: z.ZodOptional<z.ZodString>;
            maxPrice: z.ZodOptional<z.ZodString>;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
            intent: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<z.ZodString>;
            amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
            currency: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
    post: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            in: z.ZodString;
            name: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        requestBody: z.ZodOptional<z.ZodObject<{
            required: z.ZodOptional<z.ZodBoolean>;
            content: z.ZodRecord<z.ZodString, z.ZodObject<{
                schema: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        'x-payment-info': z.ZodOptional<z.ZodObject<{
            pricingMode: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            minPrice: z.ZodOptional<z.ZodString>;
            maxPrice: z.ZodOptional<z.ZodString>;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
            intent: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<z.ZodString>;
            amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
            currency: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
    put: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            in: z.ZodString;
            name: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        requestBody: z.ZodOptional<z.ZodObject<{
            required: z.ZodOptional<z.ZodBoolean>;
            content: z.ZodRecord<z.ZodString, z.ZodObject<{
                schema: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        'x-payment-info': z.ZodOptional<z.ZodObject<{
            pricingMode: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            minPrice: z.ZodOptional<z.ZodString>;
            maxPrice: z.ZodOptional<z.ZodString>;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
            intent: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<z.ZodString>;
            amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
            currency: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
    delete: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            in: z.ZodString;
            name: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        requestBody: z.ZodOptional<z.ZodObject<{
            required: z.ZodOptional<z.ZodBoolean>;
            content: z.ZodRecord<z.ZodString, z.ZodObject<{
                schema: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        'x-payment-info': z.ZodOptional<z.ZodObject<{
            pricingMode: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            minPrice: z.ZodOptional<z.ZodString>;
            maxPrice: z.ZodOptional<z.ZodString>;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
            intent: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<z.ZodString>;
            amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
            currency: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
    patch: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            in: z.ZodString;
            name: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        requestBody: z.ZodOptional<z.ZodObject<{
            required: z.ZodOptional<z.ZodBoolean>;
            content: z.ZodRecord<z.ZodString, z.ZodObject<{
                schema: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        'x-payment-info': z.ZodOptional<z.ZodObject<{
            pricingMode: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            minPrice: z.ZodOptional<z.ZodString>;
            maxPrice: z.ZodOptional<z.ZodString>;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
            intent: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<z.ZodString>;
            amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
            currency: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
    head: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            in: z.ZodString;
            name: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        requestBody: z.ZodOptional<z.ZodObject<{
            required: z.ZodOptional<z.ZodBoolean>;
            content: z.ZodRecord<z.ZodString, z.ZodObject<{
                schema: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        'x-payment-info': z.ZodOptional<z.ZodObject<{
            pricingMode: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            minPrice: z.ZodOptional<z.ZodString>;
            maxPrice: z.ZodOptional<z.ZodString>;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
            intent: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<z.ZodString>;
            amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
            currency: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
    options: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            in: z.ZodString;
            name: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        requestBody: z.ZodOptional<z.ZodObject<{
            required: z.ZodOptional<z.ZodBoolean>;
            content: z.ZodRecord<z.ZodString, z.ZodObject<{
                schema: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        'x-payment-info': z.ZodOptional<z.ZodObject<{
            pricingMode: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            minPrice: z.ZodOptional<z.ZodString>;
            maxPrice: z.ZodOptional<z.ZodString>;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
            intent: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<z.ZodString>;
            amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
            currency: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
    trace: z.ZodOptional<z.ZodObject<{
        operationId: z.ZodOptional<z.ZodString>;
        summary: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
        security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
        parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
            in: z.ZodString;
            name: z.ZodString;
            schema: z.ZodOptional<z.ZodUnknown>;
            required: z.ZodOptional<z.ZodBoolean>;
        }, z.core.$strip>>>;
        requestBody: z.ZodOptional<z.ZodObject<{
            required: z.ZodOptional<z.ZodBoolean>;
            content: z.ZodRecord<z.ZodString, z.ZodObject<{
                schema: z.ZodOptional<z.ZodUnknown>;
            }, z.core.$strip>>;
        }, z.core.$strip>>;
        responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
        'x-payment-info': z.ZodOptional<z.ZodObject<{
            pricingMode: z.ZodOptional<z.ZodString>;
            price: z.ZodOptional<z.ZodString>;
            minPrice: z.ZodOptional<z.ZodString>;
            maxPrice: z.ZodOptional<z.ZodString>;
            protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
            intent: z.ZodOptional<z.ZodString>;
            method: z.ZodOptional<z.ZodString>;
            amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
            currency: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$loose>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
declare const OpenApiDocSchema: z.ZodObject<{
    openapi: z.ZodString;
    info: z.ZodObject<{
        title: z.ZodString;
        version: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        guidance: z.ZodOptional<z.ZodString>;
        'x-guidance': z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
    servers: z.ZodOptional<z.ZodArray<z.ZodObject<{
        url: z.ZodString;
    }, z.core.$strip>>>;
    tags: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
    }, z.core.$strip>>>;
    components: z.ZodOptional<z.ZodObject<{
        securitySchemes: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
    'x-discovery': z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    paths: z.ZodRecord<z.ZodString, z.ZodObject<{
        get: z.ZodOptional<z.ZodObject<{
            operationId: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
            parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                in: z.ZodString;
                name: z.ZodString;
                schema: z.ZodOptional<z.ZodUnknown>;
                required: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            requestBody: z.ZodOptional<z.ZodObject<{
                required: z.ZodOptional<z.ZodBoolean>;
                content: z.ZodRecord<z.ZodString, z.ZodObject<{
                    schema: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            'x-payment-info': z.ZodOptional<z.ZodObject<{
                pricingMode: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                minPrice: z.ZodOptional<z.ZodString>;
                maxPrice: z.ZodOptional<z.ZodString>;
                protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
                intent: z.ZodOptional<z.ZodString>;
                method: z.ZodOptional<z.ZodString>;
                amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
                currency: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
        post: z.ZodOptional<z.ZodObject<{
            operationId: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
            parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                in: z.ZodString;
                name: z.ZodString;
                schema: z.ZodOptional<z.ZodUnknown>;
                required: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            requestBody: z.ZodOptional<z.ZodObject<{
                required: z.ZodOptional<z.ZodBoolean>;
                content: z.ZodRecord<z.ZodString, z.ZodObject<{
                    schema: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            'x-payment-info': z.ZodOptional<z.ZodObject<{
                pricingMode: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                minPrice: z.ZodOptional<z.ZodString>;
                maxPrice: z.ZodOptional<z.ZodString>;
                protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
                intent: z.ZodOptional<z.ZodString>;
                method: z.ZodOptional<z.ZodString>;
                amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
                currency: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
        put: z.ZodOptional<z.ZodObject<{
            operationId: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
            parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                in: z.ZodString;
                name: z.ZodString;
                schema: z.ZodOptional<z.ZodUnknown>;
                required: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            requestBody: z.ZodOptional<z.ZodObject<{
                required: z.ZodOptional<z.ZodBoolean>;
                content: z.ZodRecord<z.ZodString, z.ZodObject<{
                    schema: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            'x-payment-info': z.ZodOptional<z.ZodObject<{
                pricingMode: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                minPrice: z.ZodOptional<z.ZodString>;
                maxPrice: z.ZodOptional<z.ZodString>;
                protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
                intent: z.ZodOptional<z.ZodString>;
                method: z.ZodOptional<z.ZodString>;
                amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
                currency: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
        delete: z.ZodOptional<z.ZodObject<{
            operationId: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
            parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                in: z.ZodString;
                name: z.ZodString;
                schema: z.ZodOptional<z.ZodUnknown>;
                required: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            requestBody: z.ZodOptional<z.ZodObject<{
                required: z.ZodOptional<z.ZodBoolean>;
                content: z.ZodRecord<z.ZodString, z.ZodObject<{
                    schema: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            'x-payment-info': z.ZodOptional<z.ZodObject<{
                pricingMode: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                minPrice: z.ZodOptional<z.ZodString>;
                maxPrice: z.ZodOptional<z.ZodString>;
                protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
                intent: z.ZodOptional<z.ZodString>;
                method: z.ZodOptional<z.ZodString>;
                amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
                currency: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
        patch: z.ZodOptional<z.ZodObject<{
            operationId: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
            parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                in: z.ZodString;
                name: z.ZodString;
                schema: z.ZodOptional<z.ZodUnknown>;
                required: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            requestBody: z.ZodOptional<z.ZodObject<{
                required: z.ZodOptional<z.ZodBoolean>;
                content: z.ZodRecord<z.ZodString, z.ZodObject<{
                    schema: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            'x-payment-info': z.ZodOptional<z.ZodObject<{
                pricingMode: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                minPrice: z.ZodOptional<z.ZodString>;
                maxPrice: z.ZodOptional<z.ZodString>;
                protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
                intent: z.ZodOptional<z.ZodString>;
                method: z.ZodOptional<z.ZodString>;
                amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
                currency: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
        head: z.ZodOptional<z.ZodObject<{
            operationId: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
            parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                in: z.ZodString;
                name: z.ZodString;
                schema: z.ZodOptional<z.ZodUnknown>;
                required: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            requestBody: z.ZodOptional<z.ZodObject<{
                required: z.ZodOptional<z.ZodBoolean>;
                content: z.ZodRecord<z.ZodString, z.ZodObject<{
                    schema: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            'x-payment-info': z.ZodOptional<z.ZodObject<{
                pricingMode: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                minPrice: z.ZodOptional<z.ZodString>;
                maxPrice: z.ZodOptional<z.ZodString>;
                protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
                intent: z.ZodOptional<z.ZodString>;
                method: z.ZodOptional<z.ZodString>;
                amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
                currency: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
        options: z.ZodOptional<z.ZodObject<{
            operationId: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
            parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                in: z.ZodString;
                name: z.ZodString;
                schema: z.ZodOptional<z.ZodUnknown>;
                required: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            requestBody: z.ZodOptional<z.ZodObject<{
                required: z.ZodOptional<z.ZodBoolean>;
                content: z.ZodRecord<z.ZodString, z.ZodObject<{
                    schema: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            'x-payment-info': z.ZodOptional<z.ZodObject<{
                pricingMode: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                minPrice: z.ZodOptional<z.ZodString>;
                maxPrice: z.ZodOptional<z.ZodString>;
                protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
                intent: z.ZodOptional<z.ZodString>;
                method: z.ZodOptional<z.ZodString>;
                amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
                currency: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
        trace: z.ZodOptional<z.ZodObject<{
            operationId: z.ZodOptional<z.ZodString>;
            summary: z.ZodOptional<z.ZodString>;
            description: z.ZodOptional<z.ZodString>;
            tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
            security: z.ZodOptional<z.ZodArray<z.ZodRecord<z.ZodString, z.ZodArray<z.ZodString>>>>;
            parameters: z.ZodOptional<z.ZodArray<z.ZodObject<{
                in: z.ZodString;
                name: z.ZodString;
                schema: z.ZodOptional<z.ZodUnknown>;
                required: z.ZodOptional<z.ZodBoolean>;
            }, z.core.$strip>>>;
            requestBody: z.ZodOptional<z.ZodObject<{
                required: z.ZodOptional<z.ZodBoolean>;
                content: z.ZodRecord<z.ZodString, z.ZodObject<{
                    schema: z.ZodOptional<z.ZodUnknown>;
                }, z.core.$strip>>;
            }, z.core.$strip>>;
            responses: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
            'x-payment-info': z.ZodOptional<z.ZodObject<{
                pricingMode: z.ZodOptional<z.ZodString>;
                price: z.ZodOptional<z.ZodString>;
                minPrice: z.ZodOptional<z.ZodString>;
                maxPrice: z.ZodOptional<z.ZodString>;
                protocols: z.ZodOptional<z.ZodArray<z.ZodString>>;
                intent: z.ZodOptional<z.ZodString>;
                method: z.ZodOptional<z.ZodString>;
                amount: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
                currency: z.ZodOptional<z.ZodString>;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$loose>>;
        }, z.core.$strip>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
type OpenApiDoc = z.infer<typeof OpenApiDocSchema>;
type OpenApiOperation = z.infer<typeof OpenApiOperationSchema>;
type OpenApiPathItem = z.infer<typeof OpenApiPathItemSchema>;
type OpenApiPaymentInfo = z.infer<typeof OpenApiPaymentInfoSchema>;
/** Raw shape of the /.well-known/x402 JSON response. */
declare const WellKnownDocSchema: z.ZodObject<{
    version: z.ZodOptional<z.ZodNumber>;
    resources: z.ZodDefault<z.ZodArray<z.ZodString>>;
    mppResources: z.ZodOptional<z.ZodArray<z.ZodString>>;
    description: z.ZodOptional<z.ZodString>;
    ownershipProofs: z.ZodOptional<z.ZodArray<z.ZodString>>;
    instructions: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Parsed output after resolving resource strings into typed routes. */
declare const WellKnownParsedSchema: z.ZodObject<{
    routes: z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        method: z.ZodEnum<{
            GET: "GET";
            POST: "POST";
            PUT: "PUT";
            DELETE: "DELETE";
            PATCH: "PATCH";
            HEAD: "HEAD";
            OPTIONS: "OPTIONS";
            TRACE: "TRACE";
        }>;
        price: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
    instructions: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
type WellKnownDoc = z.infer<typeof WellKnownDocSchema>;
type WellKnownParsed = z.infer<typeof WellKnownParsedSchema>;

export { type OpenApiDoc, OpenApiDocSchema, type OpenApiOperation, OpenApiOperationSchema, type OpenApiPathItem, OpenApiPathItemSchema, type OpenApiPaymentInfo, OpenApiPaymentInfoSchema, type WellKnownDoc, WellKnownDocSchema, type WellKnownParsed, WellKnownParsedSchema };
