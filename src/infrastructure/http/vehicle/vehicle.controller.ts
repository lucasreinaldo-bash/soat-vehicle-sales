import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CreateVehicleUseCase } from '../../../application/use-cases/vehicle/create-vehicle.usecase';
import { UpdateVehicleUseCase } from '../../../application/use-cases/vehicle/update-vehicle.usecase';
import { GetVehicleUseCase } from '../../../application/use-cases/vehicle/get-vehicle.usecase';
import { ListAvailableVehiclesUseCase } from '../../../application/use-cases/vehicle/list-available-vehicles.usecase';
import { ListSoldVehiclesUseCase } from '../../../application/use-cases/vehicle/list-sold-vehicles.usecase';
import { PurchaseVehicleUseCase } from '../../../application/use-cases/sale/purchase-vehicle.usecase';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleResponseDto } from './dto/vehicle-response.dto';
import { PurchaseResponseDto } from './dto/purchase-response.dto';
import { CurrentUser, Public, Roles } from '../auth/auth.decorators';
import { AuthenticatedUser } from '../auth/authenticated-user';

@ApiTags('Veículos')
@Controller('vehicles')
export class VehicleController {
  constructor(
    private readonly createVehicle: CreateVehicleUseCase,
    private readonly updateVehicle: UpdateVehicleUseCase,
    private readonly getVehicle: GetVehicleUseCase,
    private readonly listAvailableVehicles: ListAvailableVehiclesUseCase,
    private readonly listSoldVehicles: ListSoldVehiclesUseCase,
    private readonly purchaseVehicle: PurchaseVehicleUseCase,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles('admin')
  @ApiBearerAuth()
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado' })
  @ApiResponse({ status: 403, description: 'Exige o papel admin' })
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

  @Public()
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

  @Public()
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

  @Public()
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
  @Roles('admin')
  @ApiBearerAuth()
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado' })
  @ApiResponse({ status: 403, description: 'Exige o papel admin' })
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

  @Post(':id/purchase')
  @HttpCode(HttpStatus.CREATED)
  @Roles('customer')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Comprar um veículo',
    description:
      'Compra feita pelo próprio cliente, autenticado com o token do serviço de identidade. ' +
      'O comprador é identificado pelo token — o corpo da requisição é vazio, e nenhum dado ' +
      'pessoal trafega para esta API. A compra nasce em PENDING_PAYMENT e reserva o veículo; ' +
      'é efetivada quando o processador de pagamento notifica POST /payments/webhook com o ' +
      'paymentCode retornado aqui.',
  })
  @ApiParam({ name: 'id', description: 'Identificador do veículo' })
  @ApiResponse({ status: 201, description: 'Compra registrada', type: PurchaseResponseDto })
  @ApiResponse({ status: 401, description: 'Token ausente, inválido ou expirado' })
  @ApiResponse({ status: 403, description: 'Exige o papel customer (cliente cadastrado)' })
  @ApiResponse({ status: 404, description: 'Veículo não encontrado' })
  @ApiResponse({ status: 409, description: 'Veículo não está disponível' })
  async purchase(
    @Param('id') id: string,
    @CurrentUser() usuario: AuthenticatedUser,
  ): Promise<PurchaseResponseDto> {
    const { sale } = await this.purchaseVehicle.execute({ vehicleId: id, buyerId: usuario.id });
    return PurchaseResponseDto.fromDomain(sale);
  }
}
