const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
  }
}

export function text(value, field, { min = 1, max = 500, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string') throw new ValidationError(`${field} deve ser um texto.`);
  const normalized = value.trim();
  if (normalized.length < min || normalized.length > max) {
    throw new ValidationError(`${field} deve ter entre ${min} e ${max} caracteres.`);
  }
  return normalized;
}

export function email(value, field = 'E-mail') {
  const normalized = text(value, field, { max: 160 }).toLowerCase();
  if (!EMAIL.test(normalized)) throw new ValidationError(`${field} inválido.`);
  return normalized;
}

export function number(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return null;
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < min || normalized > max) {
    throw new ValidationError(`${field} deve ser um número entre ${min} e ${max}.`);
  }
  return normalized;
}

export function integer(value, field, options = {}) {
  const normalized = number(value, field, options);
  if (normalized !== null && !Number.isInteger(normalized)) throw new ValidationError(`${field} deve ser inteiro.`);
  return normalized;
}

export function enumeration(value, field, allowed) {
  if (!allowed.includes(value)) throw new ValidationError(`${field} deve ser: ${allowed.join(', ')}.`);
  return value;
}

export function boolean(value) {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

export function webUrl(value, field = 'URL') {
  const normalized = text(value, field, { max: 500, optional: true });
  if (normalized === null) return null;
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
    return parsed.href;
  } catch {
    throw new ValidationError(`${field} deve começar com http:// ou https://.`);
  }
}

export function animalPayload(body) {
  return {
    name: text(body.name, 'Nome', { max: 80 }),
    species: enumeration(body.species, 'Espécie', ['cao', 'gato', 'outro']),
    sex: enumeration(body.sex, 'Sexo', ['macho', 'femea', 'nao_informado']),
    ageYears: number(body.ageYears, 'Idade', { min: 0, max: 40 }),
    size: enumeration(body.size, 'Porte', ['pequeno', 'medio', 'grande']),
    description: text(body.description, 'Descrição', { min: 20, max: 800 }),
    photoUrl: webUrl(body.photoUrl, 'URL da foto'),
    vaccinationStatus: enumeration(body.vaccinationStatus ?? 'nao_informado', 'Vacinação', ['nao_informado', 'em_dia', 'parcial', 'pendente']),
    neutered: boolean(body.neutered),
    dewormed: boolean(body.dewormed),
    specialNeeds: text(body.specialNeeds, 'Necessidades especiais', { max: 500, optional: true }),
    healthNotes: text(body.healthNotes, 'Observações de saúde', { max: 1000, optional: true }),
    status: enumeration(body.status, 'Status', ['disponivel', 'em_processo', 'adotado'])
  };
}

export function adoptionPayload(body) {
  return {
    animalId: integer(body.animalId, 'Animal', { min: 1 }),
    applicantName: text(body.applicantName, 'Nome', { min: 3, max: 120 }),
    email: email(body.email),
    phone: text(body.phone, 'Telefone', { min: 8, max: 30 }),
    housingType: enumeration(body.housingType, 'Tipo de moradia', ['casa', 'apartamento', 'outro']),
    hasOtherPets: boolean(body.hasOtherPets),
    reason: text(body.reason, 'Motivação', { min: 30, max: 1000 })
  };
}

export function needPayload(body) {
  const targetQuantity = number(body.targetQuantity, 'Meta', { min: 1, max: 1000000 });
  const currentQuantity = number(body.currentQuantity ?? 0, 'Quantidade atual', { min: 0, max: 1000000 });
  return {
    title: text(body.title, 'Título', { max: 120 }),
    description: text(body.description, 'Descrição', { min: 10, max: 500 }),
    priority: enumeration(body.priority, 'Prioridade', ['alta', 'media', 'baixa']),
    targetQuantity,
    currentQuantity,
    unit: text(body.unit, 'Unidade', { max: 30 }),
    active: body.active === false || body.active === 0 ? 0 : 1
  };
}

export function donationPayload(body) {
  const type = enumeration(body.type, 'Tipo', ['financeira', 'item']);
  const amount = number(body.amount, 'Valor', { min: 0.01, max: 1000000, optional: type !== 'financeira' });
  const itemDescription = text(body.itemDescription, 'Descrição do item', { min: 3, max: 300, optional: type !== 'item' });
  if (type === 'financeira' && amount === null) throw new ValidationError('Informe um valor positivo.');
  if (type === 'item' && itemDescription === null) throw new ValidationError('Descreva o item doado.');
  return {
    donorName: text(body.donorName, 'Nome', { min: 3, max: 120 }),
    email: email(body.email),
    type,
    amount,
    itemDescription
  };
}

export function passwordPayload(body) {
  const currentPassword = text(body.currentPassword, 'Senha atual', { min: 8, max: 200 });
  const newPassword = text(body.newPassword, 'Nova senha', { min: 12, max: 200 });
  if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/\d/.test(newPassword)) {
    throw new ValidationError('A nova senha deve conter letra maiúscula, letra minúscula e número.');
  }
  if (currentPassword === newPassword) throw new ValidationError('A nova senha deve ser diferente da atual.');
  return { currentPassword, newPassword };
}
