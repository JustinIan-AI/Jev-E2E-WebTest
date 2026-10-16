import { describe, it, expect } from 'vitest';
import { OpenApiParser } from '../../src/parsers/openapi.parser';

const parser = new OpenApiParser();

const MINIMAL_SPEC = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        summary: 'List users',
        responses: { '200': { description: 'Success' } },
      },
    },
  },
});

const YAML_SPEC = `
openapi: "3.0.0"
info:
  title: YAML API
  version: "2.0.0"
paths:
  /products:
    get:
      summary: List products
      parameters:
        - name: limit
          in: query
          schema:
            type: integer
      responses:
        "200":
          description: OK
    post:
      summary: Create product
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                name:
                  type: string
                price:
                  type: number
      responses:
        "201":
          description: Created
  /products/{id}:
    get:
      summary: Get product
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: OK
        "404":
          description: Not found
    delete:
      summary: Delete product
      responses:
        "204":
          description: Deleted
`;

describe('OpenApiParser — JSON format', () => {
  it('should parse minimal JSON spec', () => {
    const result = parser.parse(MINIMAL_SPEC);
    expect(result.type).toBe('openapi');
    expect(result.title).toBe('Test API');
    expect(result.endpoints.length).toBeGreaterThan(0);
    expect(result.scenarios.length).toBeGreaterThan(0);
  });

  it('should extract endpoint method and path', () => {
    const result = parser.parse(MINIMAL_SPEC);
    const ep = result.endpoints[0];
    expect(ep.method).toBe('GET');
    expect(ep.path).toBe('/users');
  });

  it('should detect openapi spec with canParse', () => {
    expect(parser.canParse(MINIMAL_SPEC)).toBe(true);
  });

  it('should reject non-openapi JSON', () => {
    expect(parser.canParse('{"name": "not an api"}')).toBe(false);
  });

  it('should reject garbage input', () => {
    expect(parser.canParse('not json or yaml at all')).toBe(false);
  });
});

describe('OpenApiParser — YAML format', () => {
  it('should parse YAML spec', () => {
    const result = parser.parse(YAML_SPEC);
    expect(result.type).toBe('openapi');
    expect(result.title).toBe('YAML API');
  });

  it('should extract all endpoints from YAML', () => {
    const result = parser.parse(YAML_SPEC);
    // /products GET, POST + /products/{id} GET, DELETE = 4
    expect(result.endpoints.length).toBe(4);
  });

  it('should extract path parameters', () => {
    const result = parser.parse(YAML_SPEC);
    const getById = result.endpoints.find((e) => e.path === '/products/{id}' && e.method === 'GET');
    expect(getById).toBeDefined();
  });

  it('should detect YAML openapi spec with canParse', () => {
    expect(parser.canParse(YAML_SPEC)).toBe(true);
  });

  it('should generate scenarios from endpoints', () => {
    const result = parser.parse(YAML_SPEC);
    expect(result.scenarios.length).toBe(4);
    const getScenario = result.scenarios.find((s) => s.title.includes('List products'));
    expect(getScenario).toBeDefined();
  });
});

describe('OpenApiParser — complex specs', () => {
  it('should handle spec with multiple response codes', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Multi', version: '1.0' },
      paths: {
        '/items/{id}': {
          get: {
            summary: 'Get item',
            responses: {
              '200': { description: 'Found' },
              '404': { description: 'Not found' },
              '500': { description: 'Error' },
            },
          },
        },
      },
    });

    const result = parser.parse(spec);
    expect(result.endpoints).toHaveLength(1);
  });

  it('should handle empty paths', () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Empty', version: '1.0' },
      paths: {},
    });

    const result = parser.parse(spec);
    expect(result.endpoints).toHaveLength(0);
    expect(result.scenarios).toHaveLength(0);
  });

  it('should handle swagger 2.0 detection', () => {
    const spec = JSON.stringify({ swagger: '2.0', info: { title: 'Old' }, paths: {} });
    expect(parser.canParse(spec)).toBe(true);
  });

  it('should preserve raw content', () => {
    const result = parser.parse(MINIMAL_SPEC);
    expect(result.rawContent).toBe(MINIMAL_SPEC);
  });

  it('should default title when missing', () => {
    const spec = JSON.stringify({ openapi: '3.0.0', paths: {} });
    const result = parser.parse(spec);
    expect(result.title).toBe('API');
  });
});
