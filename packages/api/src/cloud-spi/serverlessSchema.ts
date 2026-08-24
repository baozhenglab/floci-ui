import type {CapabilitySchema, CloudProvider, FieldSchema, ResourceActionName, ServiceSchema, TableColumnSchema} from './types'

const serverlessColumns: TableColumnSchema[] = [
    {name: 'name', label: 'Function Name'},
    {name: 'type', label: 'Type'},
    {name: 'cloud', label: 'Cloud'},
    {name: 'region', label: 'Region'},
    {name: 'runtime', label: 'Runtime', path: 'metadata.runtime'},
    {name: 'status', label: 'Status'},
    {name: 'updatedAt', label: 'Last Updated', path: 'metadata.lastModified', format: 'datetime'},
]

/** Invoke is the verb that distinguishes serverless from every other category. */
function serverlessResourceActions(
    invoke: CapabilitySchema<ResourceActionName>,
): CapabilitySchema<ResourceActionName>[] {
    return [
        {name: 'list', label: 'List functions', enabled: true, status: 'available', runtimeRequired: true},
        {name: 'create', label: 'Create function', enabled: true, status: 'available', runtimeRequired: true},
        {name: 'delete', label: 'Delete function', enabled: true, status: 'available', runtimeRequired: true},
        {name: 'inspect', label: 'Inspect function', enabled: true, status: 'available', runtimeRequired: false},
        invoke,
    ]
}

const serverlessFilters: FieldSchema[] = [
    {name: 'search', label: 'Search', type: 'text', required: false},
    {name: 'runtime', label: 'Runtime', type: 'text', required: false},
]

export function awsServerlessSchema(): ServiceSchema {
    return {
        cloud: 'aws',
        service: 'serverless',
        displayName: 'AWS Lambda',
        fields: [
    {
        name: 'functionName',
        label: 'Function Name',
        type: 'text',
        required: true,
        description: 'Unique Lambda function name.',
    },
    {
        name: 'runtime',
        label: 'Runtime',
        type: 'select',
        required: true,
        options: [
            {label: 'Node.js 20.x', value: 'nodejs20.x'},
            {label: 'Node.js 18.x', value: 'nodejs18.x'},
            {label: 'Python 3.12', value: 'python3.12'},
            {label: 'Python 3.11', value: 'python3.11'},
        ],
    },
    {
        name: 'handler',
        label: 'Handler',
        type: 'text',
        required: true,
        description: 'Example: index.handler',
    },
    {
        name: 'role',
        label: 'Execution Role ARN',
        type: 'text',
        required: true,
        description: 'IAM role ARN used by the Lambda function.',
    },
    {
        name: 'memorySize',
        label: 'Memory Size',
        type: 'text',
        required: false,
        description: 'Memory in MB. Default: 128.',
    },
    {
        name: 'timeout',
        label: 'Timeout',
        type: 'text',
        required: false,
        description: 'Timeout in seconds. Default: 3.',
    },
    {
        name: 'description',
        label: 'Description',
        type: 'text',
        required: false,
    },
    {
        name: 'code',
        label: 'Inline Code',
        type: 'text',
        required: false,
        description: 'Optional inline starter code. ZIP upload will come in a later PR.',
        span: true,
    },
],
        actions: ['list', 'create', 'inspect', 'delete'],
        filters: serverlessFilters,
        columns: serverlessColumns,
        capabilities: {
            resourceActions: serverlessResourceActions({
                name: 'invoke', label: 'Invoke function', enabled: true, status: 'available', runtimeRequired: true,
            }),
        },
    }
}
