import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateVehicleUseCase } from '../../../application/use-cases/vehicle/create-vehicle.usecase';
import { UpdateVehicleUseCase } from '../../../application/use-cases/vehicle/update-vehicle.usecase';
import { GetVehicleUseCase } from '../../../application/use-cases/vehicle/get-vehicle.usecase';
import { ListAvailableVehiclesUseCase } from '../../../application/use-cases/vehicle/list-available-vehicles.usecase';
import { ListSoldVehiclesUseCase } from '../../../application/use-cases/vehicle/list-sold-vehicles.usecase';
import { SellVehicleUseCase } from '../../../application/use-cases/sale/sell-vehicle.usecase';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { SellVehicleDto } from './dto/sell-vehicle.dto';
import { VehicleResponseDto } from './dto/vehicle-response.dto';
import { SellVehicleResponseDto } from './dto/sell-vehicle-response.dto';

@ApiTags('Veículos')
@Controller('vehicles')
export class VehicleController {
  constructor(
    private readonly createVehicle: CreateVehicleUseCase,
    private readonly updateVehicle: UpdateVehicleUseCase,
    private readonly getVehicle: GetVehicleUseCase,
    private readonly listAvailableVehicles: ListAvailableVehiclesUseCase,
    private readonly listSoldVehicles: ListSoldVehiclesUseCase,
    private readonly sellVehicle: SellVehicleUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cadastrar um veículo para venda',
    description: 'Cria um veículo no catálogo com status AVAILABLE (disponível para venda).',
  })
  @ApiResponse({ status: 201, description: 'Veículo cadastrado', type: VehicleResponseDto })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  async create(@Body() dto: CreateVehicleDto): Promise<VehicleResponseDto> {
    const vehicle = await this.createVehicle.execute(dto);
    return VehicleResponseDto.fromDomain(vehicle);
  }

  @Get('available')
  @ApiOperation({
    summary: 'Listar veículos à venda',
    description:
      'Retorna os veículos disponíveis, ordenados por preço (do mais barato ao mais caro).',
  })
  @ApiResponse({ status: 200, type: [VehicleResponseDto] })
  async listAvailable(): Promise<VehicleResponseDto[]> {
    const vehicles = await this.listAvailableVehicles.execute();
    return vehicles.map((vehicle) => VehicleResponseDto.fromDomain(vehicle));
  }

  @Get('sold')
  @ApiOperation({
    summary: 'Listar veículos vendidos',
    description:
      'Retorna os veículos já vendidos (pagamento confirmado), ordenados por preço (do mais barato ao mais caro).',
  })
  @ApiResponse({ status: 200, type: [VehicleResponseDto] })
  async listSold(): Promise<VehicleResponseDto[]> {
    const vehicles = await this.listSoldVehicles.execute();
    return vehicles.map((vehicle) => VehicleResponseDto.fromDomain(vehicle));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar um veículo pelo id' })
  @ApiParam({ name: 'id', description: 'Identificador do veículo' })
  @ApiResponse({ status: 200, type: VehicleResponseDto })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado' })
  async findOne(@Param('id') id: string): Promise<VehicleResponseDto> {
    const vehicle = await this.getVehicle.execute(id);
    return VehicleResponseDto.fromDomain(vehicle);
  }

  @Put(':id')
  @ApiOperation({
    summary: 'Editar os dados de um veículo',
    description: 'Atualiza os dados de um veículo. Veículos já vendidos não podem ser editados.',
  })
  @ApiParam({ name: 'id', description: 'Identificador do veículo' })
  @ApiResponse({ status: 200, type: VehicleResponseDto })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado' })
  @ApiResponse({ status: 409, description: 'Veículo já vendido' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVehicleDto,
  ): Promise<VehicleResponseDto> {
    const vehicle = await this.updateVehicle.execute({ id, ...dto });
    return VehicleResponseDto.fromDomain(vehicle);
  }

  @Post(':id/sale')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Efetuar a venda de um veículo',
    description:
      'Registra a venda (CPF do comprador e data da venda, esta atribuída pelo sistema se omitida), ' +
      'solicita a cobrança ao ' +
      'processador de pagamento e reserva o veículo. A venda é concluída quando o processador de ' +
      'pagamento notificar o webhook POST /payments/webhook usando o paymentCode retornado aqui.',
  })
  @ApiParam({ name: 'id', description: 'Identificador do veículo' })
  @ApiBody({ type: SellVehicleDto })
  @ApiResponse({ status: 201, description: 'Venda registrada', type: SellVehicleResponseDto })
  @ApiResponse({ status: 400, description: 'CPF inválido ou data da venda no futuro' })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado' })
  @ApiResponse({ status: 409, description: 'Veículo não está disponível para venda' })
  async sell(
    @Param('id') id: string,
    @Body() dto: SellVehicleDto,
  ): Promise<SellVehicleResponseDto> {
    const { sale } = await this.sellVehicle.execute({
      vehicleId: id,
      buyerCpf: dto.buyerCpf,
      saleDate: dto.saleDate ? new Date(dto.saleDate) : undefined,
    });
    return SellVehicleResponseDto.fromDomain(sale);
  }
}
