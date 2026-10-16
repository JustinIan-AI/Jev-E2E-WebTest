import YAML from 'yaml';
import { ParsedInput, ParsedEndpoint, ParsedScenario } from '../core/types';

export class OpenApiParser {
  parse(content: string): ParsedInput {
    const spec = this.parseSpec(content);
    const info = spec.info as Record<string, unknown> | undefined;
    const title = String(info?.title || 'API');
    const endpoints = this.extractEndpoints(spec);
    const scenarios = endpoints.map((ep) => this.endpointToScenario(ep));

    return {
      type: 'openapi',
      title,
      scenarios,
      endpoints,
      rawContent: content,
    };
  }

  canParse(content: string): boolean {
    try {
      const data = this.parseSpec(content);
      return data.openapi !== undefined || data.swagger !== undefined;
    } catch {
      return false;
    }
  }

  private parseSpec(content: string): Record<string, unknown> {
    try {
      return JSON.parse(content);
    } catch {
      return YAML.parse(content);
    }
  }

  private extractEndpoints(spec: Record<string, unknown>): ParsedEndpoint[] {
    const endpoints: ParsedEndpoint[] = [];
    const paths = (spec.paths || {}) as Record<string, Record<string, unknown>>;

    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, details] of Object.entries(methods)) {
        if (['get', 'post', 'put', 'patch', 'delete'].includes(method)) {
          const op = details as Record<string, unknown>;
          const params = ((op.parameters || []) as Array<Record<string, unknown>>).map((p) => ({
            name: String(p.name),
            in: String(p.in),
            required: Boolean(p.required),
            type: String((p.schema as Record<string, unknown>)?.type || 'string'),
          }));

          let requestBody: ParsedEndpoint['requestBody'];
          if (op.requestBody) {
            const rb = op.requestBody as Record<string, unknown>;
            const rbContent = rb.content as Record<string, unknown> | undefined;
            if (rbContent) {
              const contentType = Object.keys(rbContent)[0] || 'application/json';
              const mediaType = rbContent[contentType] as Record<string, unknown> | undefined;
              requestBody = {
                contentType,
                schema: mediaType?.schema as Record<string, unknown>,
              };
            }
          }

          const responses: Record<string, { description: string }> = {};
          if (op.responses) {
            for (const [code, resp] of Object.entries(
              op.responses as Record<string, Record<string, unknown>>,
            )) {
              responses[code] = { description: String(resp.description || '') };
            }
          }

          endpoints.push({
            method: method.toUpperCase(),
            path,
            summary: String(op.summary || op.description || ''),
            parameters: params,
            requestBody,
            responses,
          });
        }
      }
    }

    return endpoints;
  }

  private endpointToScenario(ep: ParsedEndpoint): ParsedScenario {
    const title = `${ep.method} ${ep.path}${ep.summary ? ` - ${ep.summary}` : ''}`;
    const steps = [`Send ${ep.method} request to ${ep.path}`];

    if (ep.parameters && ep.parameters.length > 0) {
      steps.push(`With parameters: ${ep.parameters.map((p) => `${p.name} (${p.in})`).join(', ')}`);
    }

    if (ep.requestBody) {
      steps.push(`With request body (${ep.requestBody.contentType})`);
    }

    if (ep.responses) {
      for (const [code, resp] of Object.entries(ep.responses)) {
        steps.push(`Verify ${code} response: ${resp.description}`);
      }
    }

    return { title, description: title, steps };
  }
}
